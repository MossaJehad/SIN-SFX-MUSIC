import {
  ReconstructionConfig,
  ResidualNoiseChannel,
  SinusoidalTrack,
  SinusoidalTracksModel,
} from '@/types/mathModel';
import {
  createZeroPhaseWindow,
  getCachedFFT,
  HALF_PI,
  TWO_PI,
  wrapPhase,
} from '@/audio/analysis/fft';
import { DetectedSpectralPeak, SILENCE_PEAK_THRESHOLD } from '@/audio/analysis/analyzer';
import { roundSig } from './stftEngine';

/**
 * Extracts zero-phase parabolically-refined spectral peaks with boundary-compensated
 * complex correlation so amplitude and phase remain exact even on edge frames (center = 0 or L-1).
 */
export function extractBoundaryExactPeaks(
  samples: Float32Array,
  centerSample: number,
  sampleRate: number,
  fftSize: number,
  windowSize: number,
  options: {
    minFrequency: number;
    maxFrequency: number;
    minAmplitude: number;
    maxPeaks: number;
  }
): DetectedSpectralPeak[] {
  const desiredWin = Math.min(fftSize, Math.max(32, windowSize));
  const distToEdge = Math.min(centerSample, Math.max(0, samples.length - 1 - centerSample));
  // Shrink window symmetrically near boundaries (when >= 64 samples from edge) to avoid rectangular truncation sidelobes!
  const effectiveWinSize =
    distToEdge >= 64 && distToEdge * 2 + 1 < desiredWin
      ? Math.max(129, (distToEdge * 2 + 1) | 1)
      : desiredWin;

  // Use Blackman-Harris (-92 dB sidelobes) for wide windows, and Hamming (-43 dB sidelobes,
  // 2x narrower main lobe) for shrunk boundary windows so close harmonics stay cleanly separated!
  const peakWindowType = effectiveWinSize >= 768 ? 'blackman-harris' : 'hamming';
  const { window, halfLen, sum: fullWinSum } = createZeroPhaseWindow(
    effectiveWinSize,
    peakWindowType
  );
  const fft = getCachedFFT(fftSize);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  let effWinSum = 0;
  let isTruncated = false;

  for (let u = 0; u <= halfLen; u++) {
    const idx = centerSample + u;
    if (idx >= 0 && idx < samples.length) {
      const w = window[halfLen + u]!;
      real[u] = samples[idx]! * w;
      effWinSum += w;
    } else {
      isTruncated = true;
    }
  }
  for (let u = -halfLen; u < 0; u++) {
    const idx = centerSample + u;
    if (idx >= 0 && idx < samples.length) {
      const w = window[halfLen + u]!;
      real[fftSize + u] = samples[idx]! * w;
      effWinSum += w;
    } else {
      isTruncated = true;
    }
  }

  if (effWinSum <= 1e-12) return [];

  fft.transform(real, imag, false);

  const half = fftSize >> 1;
  const binRes = sampleRate / fftSize;
  const mag = new Float64Array(half + 1);
  let maxPeakMag = 0;
  for (let k = 0; k <= half; k++) {
    const m = Math.hypot(real[k]!, imag[k]!);
    mag[k] = m;
    if (k > 0 && m > maxPeakMag) maxPeakMag = m;
  }

  const ampScale = 2 / effWinSum;
  // On severely truncated edge frames (n=0 or n=L-1), suppress rectangular truncation sidelobes (-13 dB)
  const edgeFloor = isTruncated && effWinSum < fullWinSum * 0.9 ? maxPeakMag * ampScale * 0.14 : 0;
  const effectiveMinAmp = Math.max(options.minAmplitude, edgeFloor);

  const startBin = Math.max(1, Math.floor(options.minFrequency / binRes));
  const endBin = Math.min(half - 1, Math.ceil(options.maxFrequency / binRes));

  const peaks: DetectedSpectralPeak[] = [];

  for (let k = startBin; k <= endBin; k++) {
    const mPrev = mag[k - 1]!;
    const mCurr = mag[k]!;
    const mNext = mag[k + 1]!;

    if (mCurr > mPrev && mCurr >= mNext && mCurr * ampScale >= effectiveMinAmp) {
      const eps = 1e-24;
      const alpha = Math.log(mPrev + eps);
      const beta = Math.log(mCurr + eps);
      const gamma = Math.log(mNext + eps);
      const denom = alpha - 2 * beta + gamma;
      let delta = 0;
      if (Math.abs(denom) > 1e-12) {
        delta = Math.max(-0.5, Math.min(0.5, (0.5 * (alpha - gamma)) / denom));
      }

      const peakBin = k + delta;
      const peakFreq = peakBin * binRes;
      if (peakFreq < options.minFrequency || peakFreq > options.maxFrequency) continue;

      let amplitude: number;
      let sinePhase: number;

      if (isTruncated && effWinSum < fullWinSum * 0.999) {
        // Exact DTFT evaluation at fractional frequency peakFreq eliminates truncated-window phase bias
        const omegaPerSample = (TWO_PI * peakFreq) / sampleRate;
        let reSum = 0;
        let imSum = 0;
        for (let u = -halfLen; u <= halfLen; u++) {
          const idx = centerSample + u;
          if (idx >= 0 && idx < samples.length) {
            const ws = samples[idx]! * window[halfLen + u]!;
            const angle = omegaPerSample * u;
            reSum += ws * Math.cos(angle);
            imSum -= ws * Math.sin(angle);
          }
        }
        amplitude = (2 * Math.hypot(reSum, imSum)) / effWinSum;
        sinePhase = wrapPhase(Math.atan2(imSum, reSum) + HALF_PI);
      } else {
        const interpMag = Math.exp(beta - 0.25 * (alpha - gamma) * delta);
        amplitude = interpMag * ampScale;

        const p0 = Math.atan2(imag[k]!, real[k]!);
        let cosPhase = p0;
        if (Math.abs(delta) > 1e-6) {
          const neighborIdx = delta > 0 ? k + 1 : k - 1;
          const p1 = Math.atan2(imag[neighborIdx]!, real[neighborIdx]!);
          cosPhase = wrapPhase(p0 + Math.abs(delta) * wrapPhase(p1 - p0));
        }
        sinePhase = wrapPhase(cosPhase + HALF_PI);
      }

      if (amplitude >= effectiveMinAmp) {
        peaks.push({
          bin: peakBin,
          frequency: peakFreq,
          amplitude,
          phase: sinePhase,
        });
      }
    }
  }

  peaks.sort((a, b) => b.amplitude - a.amplitude);
  const topPeaks = peaks.slice(0, options.maxPeaks);

  // On severely truncated boundary frames (center=0 or center=L-1), multiple simultaneous
  // sinusoids leak into each other over the half-window. 3-pass Gauss-Seidel (CLEAN)
  // refinement eliminates boundary cross-talk and recovers exact boundary amplitude & phase!
  if (isTruncated && effWinSum < fullWinSum * 0.95 && topPeaks.length >= 2 && topPeaks.length <= 16) {
    const uStart = Math.max(-halfLen, -centerSample);
    const uEnd = Math.min(halfLen, samples.length - 1 - centerSample);
    const segLen = uEnd - uStart + 1;
    if (segLen >= 16) {
      const residual = new Float64Array(segLen);
      const winSeg = new Float64Array(segLen);
      let wSum = 0;
      for (let i = 0; i < segLen; i++) {
        const u = uStart + i;
        residual[i] = samples[centerSample + u]!;
        const w = window[halfLen + u]!;
        winSeg[i] = w;
        wSum += w;
      }

      // Subtract initial estimates from residual
      for (const pk of topPeaks) {
        const om = (TWO_PI * pk.frequency) / sampleRate;
        for (let i = 0; i < segLen; i++) {
          const u = uStart + i;
          residual[i] = residual[i]! - pk.amplitude * Math.sin(om * u + pk.phase);
        }
      }

      // 3 Gauss-Seidel passes over the detected peaks
      for (let pass = 0; pass < 3; pass++) {
        for (const pk of topPeaks) {
          const om = (TWO_PI * pk.frequency) / sampleRate;
          let dotS = 0;
          let dotC = 0;
          let normS = 0;
          let normC = 0;
          let crossSC = 0;

          for (let i = 0; i < segLen; i++) {
            const u = uStart + i;
            const origWithoutOthers = residual[i]! + pk.amplitude * Math.sin(om * u + pk.phase);
            residual[i] = origWithoutOthers;
            const w = winSeg[i]!;
            const s = Math.sin(om * u);
            const c = Math.cos(om * u);
            dotS += w * origWithoutOthers * s;
            dotC += w * origWithoutOthers * c;
            normS += w * s * s;
            normC += w * c * c;
            crossSC += w * s * c;
          }

          const det = normS * normC - crossSC * crossSC;
          if (Math.abs(det) > 1e-12 && wSum > 0) {
            const aS = (normC * dotS - crossSC * dotC) / det;
            const aC = (-crossSC * dotS + normS * dotC) / det;
            pk.amplitude = Math.hypot(aS, aC);
            pk.phase = wrapPhase(Math.atan2(aC, aS));
          }

          for (let i = 0; i < segLen; i++) {
            const u = uStart + i;
            residual[i] = residual[i]! - pk.amplitude * Math.sin(om * u + pk.phase);
          }
        }
      }
    }
  }

  return topPeaks;
}

/**
 * Analyzes audio into McAulay-Quatieri continuous sinusoidal tracks with sub-bin
 * frequency accuracy, true amplitude envelopes, and phase continuity.
 */
export function analyzeToSinusoidalTracks(
  channels: Float32Array[],
  sampleRate: number,
  originalSampleRate: number,
  config: ReconstructionConfig,
  name: string,
  options: {
    isCancelled?: () => boolean;
    onProgress?: (fraction: number) => void;
    residualNoise?: ResidualNoiseChannel[];
  } = {}
): SinusoidalTracksModel {
  const numChannels = Math.max(1, channels.length);
  const length = channels[0]?.length ?? 0;
  const duration = sampleRate > 0 ? length / sampleRate : 0;

  const fftSize = Math.max(512, config.fftSize);
  const windowSize = Math.max(64, Math.min(fftSize, config.windowSize));
  const hopSize = Math.max(32, Math.min(windowSize >> 1, config.hopSize));

  // Global peak & DC offset check
  let globalPeak = 0;
  const dcOffset: number[] = [];
  for (let c = 0; c < numChannels; c++) {
    const ch = channels[c]!;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]!;
      sum += v;
      const a = Math.abs(v);
      if (a > globalPeak) globalPeak = a;
    }
    const dc = ch.length > 0 ? sum / ch.length : 0;
    dcOffset.push(config.minFrequency <= 0 && Math.abs(dc) > 1e-5 ? roundSig(dc, 5) : 0);
  }

  if (globalPeak < SILENCE_PEAK_THRESHOLD || length === 0) {
    return {
      format: 'sin-sfx-math-v2',
      mode: 'optimized',
      representation: 'sinusoidal-tracks',
      name,
      sampleRate,
      originalSampleRate,
      duration,
      length,
      channels: numChannels,
      fftSize,
      windowSize,
      hopSize,
      numFrames: 0,
      preservePhase: config.preservePhase,
      dcOffset,
      channelTracks: Array.from({ length: numChannels }, () => []),
      stats: {
        totalFrames: 0,
        totalTracks: 0,
        maxSimultaneousTracks: 0,
        avgSimultaneousTracks: 0,
        isSilent: true,
      },
    };
  }

  const numFrames = Math.max(2, Math.ceil((length - 1) / hopSize) + 1);
  const compression = Math.max(0, Math.min(1, config.compressionAggressiveness));
  const maxOsc = Math.max(1, Math.min(256, Math.round(config.maxOscillators * (1 - compression * 0.45))));
  const effectiveDb = config.minAmplitudeDb + compression * 16;
  const minAmplitude = Math.max(globalPeak * Math.pow(10, effectiveDb / 20), 1e-6);
  // Nonlinear perceptual energy retention curve: q=0.95 -> ~99.8% energy (~28 dB floor) instead of naive 95% (13 dB)
  const qClamped = Math.max(0.1, Math.min(0.999, config.targetQuality));
  const residualBudget = Math.pow(1 - qClamped, 2.2) * (1 + compression * 2.5);
  const energyTarget = Math.max(0.1, Math.min(0.99999, 1 - residualBudget));
  const sigDigits = Math.max(3, Math.round(6 - compression * 3));
  const minFreq = Math.max(10, config.minFrequency);
  const maxFreq = Math.min(sampleRate / 2, config.maxFrequency);

  const channelTracks: SinusoidalTrack[][] = [];
  let totalTracks = 0;
  let maxSimultaneous = 0;
  let sumSimultaneous = 0;

  for (let c = 0; c < numChannels; c++) {
    const rawCh = channels[c]!;
    const dc = dcOffset[c]!;
    const ch = new Float32Array(rawCh.length);
    for (let i = 0; i < rawCh.length; i++) ch[i] = rawCh[i]! - dc;

    interface ActiveTrack {
      track: SinusoidalTrack;
      lastFreq: number;
      lastAmp: number;
      active: boolean;
    }

    const finishedTracks: SinusoidalTrack[] = [];
    let activeTracks: ActiveTrack[] = [];

    for (let m = 0; m < numFrames; m++) {
      if (options.isCancelled?.()) {
        throw new Error('CANCELLED');
      }

      const center = Math.min(length - 1, m * hopSize);
      const rawPeaks = extractBoundaryExactPeaks(ch, center, sampleRate, fftSize, windowSize, {
        minFrequency: minFreq,
        maxFrequency: maxFreq,
        minAmplitude,
        maxPeaks: maxOsc * 2,
      });

      // Keep top peaks up to energyTarget and maxOsc
      let totalPeakEnergy = 0;
      for (const p of rawPeaks) totalPeakEnergy += p.amplitude * p.amplitude;

      const peaks: DetectedSpectralPeak[] = [];
      let accumEnergy = 0;
      for (const p of rawPeaks) {
        if (peaks.length >= maxOsc) break;
        peaks.push(p);
        accumEnergy += p.amplitude * p.amplitude;
        if (totalPeakEnergy > 0 && accumEnergy >= totalPeakEnergy * energyTarget) {
          break;
        }
      }

      // McAulay-Quatieri greedy nearest-frequency track continuation
      const peakUsed = new Uint8Array(peaks.length);
      const nextActive: ActiveTrack[] = [];

      // Sort active tracks by descending amplitude so strongest partials get matching priority
      activeTracks.sort((a, b) => b.lastAmp - a.lastAmp);

      for (const at of activeTracks) {
        // Wider tracking gate allows fast laser sweeps (>10 octaves/sec) without track breaks
        const freqGate = Math.max(65, at.lastFreq * 0.22);
        let bestIdx = -1;
        let bestDist = freqGate;

        for (let pIdx = 0; pIdx < peaks.length; pIdx++) {
          if (peakUsed[pIdx]) continue;
          const dist = Math.abs(peaks[pIdx]!.frequency - at.lastFreq);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = pIdx;
          }
        }

        if (bestIdx !== -1) {
          peakUsed[bestIdx] = 1;
          const matched = peaks[bestIdx]!;
          at.track.points.push([
            roundSig(matched.frequency, sigDigits + 1),
            roundSig(matched.amplitude, sigDigits),
            config.preservePhase ? roundSig(matched.phase, sigDigits) : 0,
          ]);
          at.lastFreq = matched.frequency;
          at.lastAmp = matched.amplitude;
          nextActive.push(at);
        } else {
          finishedTracks.push(at.track);
        }
      }

      // Birth new tracks for unmatched peaks
      for (let pIdx = 0; pIdx < peaks.length; pIdx++) {
        if (peakUsed[pIdx]) continue;
        const p = peaks[pIdx]!;
        const newTrack: SinusoidalTrack = {
          startFrame: m,
          points: [
            [
              roundSig(p.frequency, sigDigits + 1),
              roundSig(p.amplitude, sigDigits),
              config.preservePhase ? roundSig(p.phase, sigDigits) : 0,
            ],
          ],
        };
        nextActive.push({
          track: newTrack,
          lastFreq: p.frequency,
          lastAmp: p.amplitude,
          active: true,
        });
      }

      activeTracks = nextActive;
      sumSimultaneous += activeTracks.length;
      if (activeTracks.length > maxSimultaneous) maxSimultaneous = activeTracks.length;

      if (options.onProgress && (m & 15) === 0) {
        options.onProgress((c * numFrames + m) / Math.max(1, numChannels * numFrames));
      }
    }

    for (const at of activeTracks) {
      finishedTracks.push(at.track);
    }

    // Optional pruning of tiny 1-frame weak glitches at high compression
    const filteredTracks =
      compression > 0.45
        ? finishedTracks.filter((tr) => {
            if (tr.points.length >= 2) return true;
            const amp = tr.points[0]?.[1] ?? 0;
            return amp >= globalPeak * 0.08;
          })
        : finishedTracks;

    // Sort tracks by descending total squared amplitude so primary partials appear first
    filteredTracks.sort((a, b) => {
      let eA = 0;
      for (const pt of a.points) eA += pt[1] * pt[1];
      let eB = 0;
      for (const pt of b.points) eB += pt[1] * pt[1];
      return eB - eA;
    });

    totalTracks += filteredTracks.length;
    channelTracks.push(filteredTracks);
  }

  return {
    format: 'sin-sfx-math-v2',
    mode: 'optimized',
    representation: 'sinusoidal-tracks',
    name,
    sampleRate,
    originalSampleRate,
    duration,
    length,
    channels: numChannels,
    fftSize,
    windowSize,
    hopSize,
    numFrames,
    preservePhase: config.preservePhase,
    dcOffset,
    channelTracks,
    residualNoise: options.residualNoise,
    stats: {
      totalFrames: numFrames * numChannels,
      totalTracks,
      maxSimultaneousTracks: maxSimultaneous,
      avgSimultaneousTracks: numFrames > 0 ? sumSimultaneous / (numFrames * numChannels) : 0,
      isSilent: false,
    },
  };
}

/**
 * Reconstructs audio PCM exclusively from a SinusoidalTracksModel using
 * McAulay-Quatieri cubic phase interpolation (when preservePhase=true) or
 * continuous quadratic phase integration (when preservePhase=false).
 * Guarantees C1 phase/frequency continuity with zero frame discontinuities.
 */
export function reconstructFromSinusoidalTracks(model: SinusoidalTracksModel): Float32Array[] {
  const { length, channels, sampleRate, hopSize, preservePhase, dcOffset, channelTracks } = model;
  const outputChannels: Float32Array[] = [];

  for (let c = 0; c < channels; c++) {
    const out64 = new Float64Array(length);
    const dc = dcOffset[c] ?? 0;
    if (dc !== 0) out64.fill(dc);

    const tracks = channelTracks[c] ?? [];

    for (const track of tracks) {
      const pts = track.points;
      if (pts.length === 0) continue;

      let runningPhase = preservePhase ? pts[0]![2] : 0;

      // Birth ramp if track starts after frame 0
      if (track.startFrame > 0) {
        const endSample = Math.min(length - 1, track.startFrame * hopSize);
        const startSample = Math.max(0, (track.startFrame - 1) * hopSize);
        const spanSamples = endSample - startSample;
        if (spanSamples > 0) {
          const [f1, a1, p1] = pts[0]!;
          const w1 = TWO_PI * f1;
          const T = spanSamples / sampleRate;
          const p0 = preservePhase ? p1 - w1 * T : 0;
          runningPhase = preservePhase ? p1 : p0 + w1 * T;

          for (let n = 0; n < spanSamples; n++) {
            const idx = startSample + n;
            if (idx >= length) break;
            const tau = n / sampleRate;
            const amp = a1 * (n / spanSamples);
            out64[idx] = out64[idx]! + amp * Math.sin(p0 + w1 * tau);
          }
        }
      }

      // Main track segments between consecutive frames
      for (let i = 0; i < pts.length - 1; i++) {
        const frameIdx0 = track.startFrame + i;
        const frameIdx1 = frameIdx0 + 1;
        const s0 = Math.min(length - 1, frameIdx0 * hopSize);
        const s1 = Math.min(length, frameIdx1 * hopSize);
        const spanSamples = s1 - s0;
        if (spanSamples <= 0) continue;

        const [f0, a0, p0] = pts[i]!;
        const [f1, a1, p1] = pts[i + 1]!;
        const w0 = TWO_PI * f0;
        const w1 = TWO_PI * f1;
        const T = spanSamples / sampleRate;

        if (preservePhase) {
          // McAulay-Quatieri (1986) maximally smooth cubic phase interpolation
          const mStar = Math.round(((p0 + w0 * T - p1) + 0.5 * (w1 - w0) * T) / TWO_PI);
          const deltaPhi = p1 - p0 - w0 * T + TWO_PI * mStar;
          const alpha = (3 * deltaPhi) / (T * T) - (w1 - w0) / T;
          const beta = (-2 * deltaPhi) / (T * T * T) + (w1 - w0) / (T * T);

          for (let n = 0; n < spanSamples; n++) {
            const idx = s0 + n;
            if (idx >= length) break;
            const tau = n / sampleRate;
            const amp = a0 + (a1 - a0) * (n / spanSamples);
            const psi = p0 + tau * (w0 + tau * (alpha + tau * beta));
            out64[idx] = out64[idx]! + amp * Math.sin(psi);
          }
        } else {
          // Continuous phase accumulation without original phase alignment
          const slope = (w1 - w0) / (2 * T);
          const phiStart = runningPhase;
          for (let n = 0; n < spanSamples; n++) {
            const idx = s0 + n;
            if (idx >= length) break;
            const tau = n / sampleRate;
            const amp = a0 + (a1 - a0) * (n / spanSamples);
            const psi = phiStart + tau * (w0 + slope * tau);
            out64[idx] = out64[idx]! + amp * Math.sin(psi);
          }
          runningPhase = wrapPhase(phiStart + T * (w0 + slope * T));
        }
      }

      // Death ramp if track ends before end of signal
      const lastFrameIdx = track.startFrame + pts.length - 1;
      const lastSample = Math.min(length - 1, lastFrameIdx * hopSize);
      if (lastSample < length - 1) {
        const deathEnd = Math.min(length, (lastFrameIdx + 1) * hopSize);
        const spanSamples = deathEnd - lastSample;
        if (spanSamples > 0) {
          const [fLast, aLast, pLast] = pts[pts.length - 1]!;
          const wLast = TWO_PI * fLast;
          const startPhi = preservePhase ? pLast : runningPhase;

          for (let n = 0; n < spanSamples; n++) {
            const idx = lastSample + n;
            if (idx >= length) break;
            const tau = n / sampleRate;
            const amp = aLast * (1 - n / spanSamples);
            out64[idx] = out64[idx]! + amp * Math.sin(startPhi + wLast * tau);
          }
        }
      }
    }

    const out32 = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      out32[i] = out64[i]!;
    }
    outputChannels.push(out32);
  }

  return outputChannels;
}
