import {
  ReconstructionConfig,
  ResidualNoiseChannel,
  StftFrameData,
  StftSinusoidsModel,
  WindowType,
} from '@/types/mathModel';
import { createWindow, getCachedFFT, TWO_PI, wrapPhase } from '@/audio/analysis/fft';
import { SILENCE_PEAK_THRESHOLD } from '@/audio/analysis/analyzer';

/**
 * Quantizes a floating-point number to a given number of significant digits.
 */
export function roundSig(val: number, sigDigits: number): number {
  if (val === 0 || !Number.isFinite(val)) return 0;
  return Number(val.toPrecision(sigDigits));
}

export function getSynthesisWindow(windowSize: number, windowType: WindowType): Float64Array {
  switch (windowType) {
    case 'rectangular':
      return createWindow(windowSize, 'rectangular');
    case 'sqrt-hann':
      return createWindow(windowSize, 'sqrt-hann');
    case 'hann':
    case 'hamming':
    case 'blackman-harris':
      return createWindow(windowSize, windowType);
  }
}

/**
 * Builds deterministic frame start positions with left/right boundary padding
 * so COLA overlap-add normalization is strictly positive at every sample [0 .. length - 1].
 */
export function computeStftFrameStarts(
  length: number,
  windowSize: number,
  hopSize: number,
  windowType: WindowType
): { padLeft: number; starts: number[] } {
  const padLeft =
    windowType === 'rectangular' && hopSize >= windowSize ? 0 : Math.max(0, windowSize - hopSize);
  const starts: number[] = [];
  for (let start = -padLeft; start < length; start += hopSize) {
    starts.push(start);
  }
  if (starts.length === 0) starts.push(0);
  return { padLeft, starts };
}

/**
 * Analyzes multi-channel PCM into an Exact or Optimized Sparse STFT Sinusoids Model.
 * In Exact mode, all Fourier sinusoidal coefficients (including DC and Nyquist) are retained
 * so reconstruction recovers the decoded signal within numerical precision.
 */
export function analyzeToStftSinusoids(
  channels: Float32Array[],
  sampleRate: number,
  originalSampleRate: number,
  config: ReconstructionConfig,
  name: string,
  options: {
    mode: 'exact' | 'optimized';
    isCancelled?: () => boolean;
    onProgress?: (fraction: number) => void;
    residualNoise?: ResidualNoiseChannel[];
  }
): StftSinusoidsModel {
  const numChannels = Math.max(1, channels.length);
  const length = channels[0]?.length ?? 0;
  const duration = sampleRate > 0 ? length / sampleRate : 0;

  // Validate FFT / window / hop geometry
  const fftSize = Math.max(64, config.fftSize);
  const windowSize = Math.max(32, Math.min(fftSize, config.windowSize));
  const maxAllowedHop =
    config.windowType === 'rectangular' ? windowSize : Math.max(16, windowSize >> 1);
  const hopSize = Math.max(16, Math.min(maxAllowedHop, config.hopSize));

  // Silence check
  let globalPeak = 0;
  for (let c = 0; c < numChannels; c++) {
    const ch = channels[c]!;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]!);
      if (a > globalPeak) globalPeak = a;
    }
  }

  if (globalPeak < SILENCE_PEAK_THRESHOLD || length === 0) {
    return {
      format: 'sin-sfx-math-v2',
      mode: options.mode,
      representation: 'stft-sinusoids',
      name,
      sampleRate,
      originalSampleRate,
      duration,
      length,
      channels: numChannels,
      fftSize,
      windowSize,
      hopSize,
      windowType: config.windowType,
      padLeft: 0,
      preservePhase: config.preservePhase,
      channelFrames: Array.from({ length: numChannels }, () => []),
      stats: {
        totalFrames: 0,
        totalSinusoids: 0,
        maxSinusoidsPerFrame: 0,
        avgSinusoidsPerFrame: 0,
        isSilent: true,
      },
    };
  }

  const fft = getCachedFFT(fftSize);
  const analysisWindow = createWindow(windowSize, config.windowType);
  const { padLeft, starts } = computeStftFrameStarts(
    length,
    windowSize,
    hopSize,
    config.windowType
  );
  const half = fftSize >> 1;
  const binRes = sampleRate / fftSize;

  const isExact = options.mode === 'exact';
  const preservePhase = isExact ? true : config.preservePhase;

  const minBin = isExact ? 1 : Math.max(1, Math.floor(config.minFrequency / binRes));
  const maxBin = isExact ? half : Math.min(half, Math.ceil(config.maxFrequency / binRes));

  // Thresholds for optimized sparse STFT
  const compression = Math.max(0, Math.min(1, config.compressionAggressiveness));
  const effectiveDbThresh = config.minAmplitudeDb + compression * 18; // tighter pruning at higher compression
  const absAmpThreshold = isExact
    ? globalPeak * 1e-12
    : Math.max(globalPeak * Math.pow(10, effectiveDbThresh / 20), 1e-7);

  const qClamped = Math.max(0.1, Math.min(0.999, config.targetQuality));
  const energyTarget = isExact
    ? 1.0
    : Math.max(0.1, Math.min(0.99999, 1 - Math.pow(1 - qClamped, 2.2) * (1 + compression * 2.5)));

  const maxOscPerFrame = isExact
    ? half
    : Math.max(1, Math.min(half, Math.round(config.maxOscillators * (1 - compression * 0.45))));

  // Numeric precision for optimized compression
  const sigDigits = isExact ? 0 : Math.max(2, Math.round(6 - compression * 3.5));

  const frameBuf = new Float64Array(fftSize);
  const realBuf = new Float64Array(fftSize);
  const imagBuf = new Float64Array(fftSize);

  const channelFrames: StftFrameData[][] = [];
  let totalSinusoids = 0;
  let maxSinusoidsPerFrame = 0;
  const totalWork = numChannels * starts.length;
  let completedWork = 0;

  for (let c = 0; c < numChannels; c++) {
    const ch = channels[c]!;
    const frames: StftFrameData[] = [];

    for (let m = 0; m < starts.length; m++) {
      if (options.isCancelled?.()) {
        throw new Error('CANCELLED');
      }

      const startSample = starts[m]!;
      frameBuf.fill(0);
      let frameEnergyCheck = 0;
      for (let i = 0; i < windowSize; i++) {
        const idx = startSample + i;
        if (idx >= 0 && idx < ch.length) {
          const v = ch[idx]! * analysisWindow[i]!;
          frameBuf[i] = v;
          frameEnergyCheck += v * v;
        }
      }

      if (frameEnergyCheck < 1e-24) {
        frames.push({ startSample, dc: 0, bins: [] });
        completedWork++;
        continue;
      }

      const { dc, amplitudes, phases } = fft.forwardSinusoids(frameBuf, realBuf, imagBuf);

      const keepDc = isExact || (config.minFrequency <= 0 && Math.abs(dc) >= absAmpThreshold);
      const outDc = keepDc ? (isExact ? dc : roundSig(dc, sigDigits)) : 0;

      const selectedBins: number[] = [];

      if (isExact) {
        for (let k = 1; k <= half; k++) {
          const amp = amplitudes[k]!;
          if (amp >= absAmpThreshold) {
            selectedBins.push(k, amp, phases[k]!);
          }
        }
      } else {
        // Collect candidate bins in frequency range above threshold
        const candidates: { k: number; amp: number; phase: number; energy: number }[] = [];
        let totalFrameBinEnergy = 0;

        for (let k = minBin; k <= maxBin; k++) {
          const amp = amplitudes[k]!;
          const energy = k === half ? amp * amp : 0.5 * amp * amp;
          totalFrameBinEnergy += energy;
          if (amp >= absAmpThreshold) {
            candidates.push({ k, amp, phase: phases[k]!, energy });
          }
        }

        // Sort descending by amplitude/energy
        candidates.sort((a, b) => b.energy - a.energy);

        let accumEnergy = 0;
        const energyStop = totalFrameBinEnergy * energyTarget;
        const limit = Math.min(maxOscPerFrame, candidates.length);

        for (let i = 0; i < limit; i++) {
          const cand = candidates[i]!;
          const outAmp = roundSig(cand.amp, sigDigits);
          // If !preservePhase, use globally-aligned deterministic phase (0 stored, reconstructed from startSample)
          const outPhase = preservePhase ? roundSig(cand.phase, sigDigits) : 0;
          selectedBins.push(cand.k, outAmp, outPhase);
          accumEnergy += cand.energy;
          if (accumEnergy >= energyStop) break;
        }
      }

      const count = selectedBins.length / 3;
      totalSinusoids += count;
      if (count > maxSinusoidsPerFrame) maxSinusoidsPerFrame = count;

      frames.push({
        startSample,
        dc: outDc,
        bins: selectedBins,
      });

      completedWork++;
      if (options.onProgress && (m & 15) === 0) {
        options.onProgress(completedWork / Math.max(1, totalWork));
      }
    }

    channelFrames.push(frames);
  }

  const totalFrames = starts.length * numChannels;
  return {
    format: 'sin-sfx-math-v2',
    mode: options.mode,
    representation: 'stft-sinusoids',
    name,
    sampleRate,
    originalSampleRate,
    duration,
    length,
    channels: numChannels,
    fftSize,
    windowSize,
    hopSize,
    windowType: config.windowType,
    padLeft,
    preservePhase,
    channelFrames,
    residualNoise: options.residualNoise,
    stats: {
      totalFrames,
      totalSinusoids,
      maxSinusoidsPerFrame,
      avgSinusoidsPerFrame: totalFrames > 0 ? totalSinusoids / totalFrames : 0,
      isSilent: false,
    },
  };
}

/**
 * Reconstructs audio PCM exclusively from a StftSinusoidsModel via O(L log N) Hermitian IFFT + WOLA.
 * Mathematically equivalent to direct evaluation of sum_k A[k] * sin(2π * f[k] * τ + φ[k]) per frame.
 */
export function reconstructFromStftSinusoids(model: StftSinusoidsModel): Float32Array[] {
  const { length, channels, fftSize, windowSize, windowType, preservePhase, channelFrames } = model;

  if (length <= 0) {
    return Array.from({ length: Math.max(1, channels) }, () => new Float32Array(0));
  }

  const fft = getCachedFFT(fftSize);
  const analysisWin = createWindow(windowSize, windowType);
  const synthWin = getSynthesisWindow(windowSize, windowType);

  const realBuf = new Float64Array(fftSize);
  const imagBuf = new Float64Array(fftSize);
  const outputChannels: Float32Array[] = [];

  for (let c = 0; c < channels; c++) {
    const frames = channelFrames[c] ?? [];
    const out64 = new Float64Array(length);
    const norm64 = new Float64Array(length);

    if (frames.length === 0) {
      outputChannels.push(new Float32Array(length));
      continue;
    }

    for (let m = 0; m < frames.length; m++) {
      const frame = frames[m]!;
      const start = frame.startSample;

      // Always accumulate window normalization weights for exact COLA division
      for (let i = 0; i < windowSize; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < length) {
          norm64[idx] = norm64[idx]! + analysisWin[i]! * synthWin[i]!;
        }
      }

      if (frame.dc === 0 && frame.bins.length === 0) continue;

      let binsToSynth: number[] = frame.bins;
      if (!preservePhase && frame.bins.length > 0) {
        // Reconstruct phase-coherent unpreserved phases aligned to global time t = start / fs
        binsToSynth = new Array(frame.bins.length);
        for (let j = 0; j + 2 < frame.bins.length; j += 3) {
          const k = frame.bins[j]!;
          const amp = frame.bins[j + 1]!;
          const globalPhase = wrapPhase((TWO_PI * k * start) / fftSize);
          binsToSynth[j] = k;
          binsToSynth[j + 1] = amp;
          binsToSynth[j + 2] = globalPhase;
        }
      }

      const timeFrame = fft.inverseFromSparseSinusoids(frame.dc, binsToSynth, realBuf, imagBuf);

      for (let i = 0; i < windowSize; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < length) {
          out64[idx] = out64[idx]! + timeFrame[i]! * synthWin[i]!;
        }
      }
    }

    const out32 = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const n = norm64[i]!;
      out32[i] = n > 1e-12 ? out64[i]! / n : 0;
    }
    outputChannels.push(out32);
  }

  return outputChannels;
}

/**
 * Direct time-domain sinusoidal evaluation for a single STFT frame (used in mathematical tests
 * to verify IFFT equivalence to explicit S(t) = dc + Σ A[k] * sin(2π f[k] t + φ[k])).
 */
export function evaluateStftFrameDirectSinusoids(
  frame: StftFrameData,
  fftSize: number,
  sampleRate: number
): Float64Array {
  const out = new Float64Array(fftSize);
  out.fill(frame.dc);
  const binRes = sampleRate / fftSize;

  for (let i = 0; i + 2 < frame.bins.length; i += 3) {
    const k = frame.bins[i]!;
    const amp = frame.bins[i + 1]!;
    const phase = frame.bins[i + 2]!;
    const freq = k * binRes;
    const omega = TWO_PI * freq;

    for (let n = 0; n < fftSize; n++) {
      const t = n / sampleRate;
      out[n] = out[n]! + amp * Math.sin(omega * t + phase);
    }
  }
  return out;
}
