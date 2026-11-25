import {
  AudioAnalysisResult,
  EnvelopePoint,
  FrequencyPoint,
  SoundClassification,
  SpectralPeakSummary,
} from '@/types/analysis';
import {
  createWindow,
  createZeroPhaseWindow,
  getCachedFFT,
  HALF_PI,
  nextPowerOf2,
  wrapPhase,
} from './fft';

export const SILENCE_PEAK_THRESHOLD = 1e-6;

/**
 * Converts multi-channel PCM arrays into an averaged mono Float32Array for feature analysis.
 * (Actual audio reconstruction preserves all channels independently.)
 */
export function channelsToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return new Float32Array(channels[0]!);

  const length = channels[0]!.length;
  const mono = new Float32Array(length);
  const invC = 1 / channels.length;

  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c]!;
    const len = Math.min(length, ch.length);
    for (let i = 0; i < len; i++) {
      mono[i] = mono[i]! + ch[i]! * invC;
    }
  }
  return mono;
}

/**
 * Converts any multi-channel AudioBuffer to a mono Float32Array.
 */
export function audioBufferToMono(buffer: AudioBuffer): Float32Array {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  return channelsToMono(channels);
}

/**
 * Calculates Zero-Crossing Rate (ZCR) across the signal.
 * Returns 0 for silent or DC signals.
 */
export function calculateZeroCrossingRate(samples: Float32Array): number {
  if (samples.length < 2) return 0;
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs < SILENCE_PEAK_THRESHOLD) return 0;

  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    const s0 = samples[i - 1]!;
    const s1 = samples[i]!;
    if ((s0 >= 0 && s1 < 0) || (s0 < 0 && s1 >= 0)) {
      crossings++;
    }
  }
  return crossings / (samples.length - 1);
}

/**
 * Calculates Spectral Centroid (frequency center of mass in Hz) from a one-sided
 * magnitude spectrum. Correctly handles both length N/2+1 (with Nyquist) and N/2.
 */
export function calculateSpectralCentroid(
  magnitude: Float32Array | Float64Array,
  sampleRate: number
): number {
  if (magnitude.length <= 1) return 0;
  let weightedSum = 0;
  let totalMagnitude = 0;
  const nyquist = sampleRate / 2;
  // For N/2 + 1 bins (odd length >= 3), last index corresponds to Nyquist (fs / 2).
  // For legacy N/2 power-of-2 bins, binWidth = nyquist / length.
  const isPowerOf2 = (magnitude.length & (magnitude.length - 1)) === 0;
  const binWidth = isPowerOf2 ? nyquist / magnitude.length : nyquist / (magnitude.length - 1);

  for (let i = 1; i < magnitude.length; i++) {
    const mag = magnitude[i]!;
    const freq = i * binWidth;
    weightedSum += freq * mag;
    totalMagnitude += mag;
  }

  return totalMagnitude > 1e-10 ? weightedSum / totalMagnitude : 0;
}

/**
 * Calculates Spectral Flatness (Wiener entropy) from magnitude spectrum.
 * Ratio of geometric mean to arithmetic mean of power spectrum (excluding DC).
 * Values near 1.0 indicate white noise; near 0.0 indicate pure tones.
 */
export function calculateSpectralFlatness(magnitude: Float32Array | Float64Array): number {
  const start = magnitude.length > 2 ? 1 : 0;
  const count = magnitude.length - start;
  if (count <= 0) return 0;

  let maxMag = 0;
  for (let i = start; i < magnitude.length; i++) {
    if (magnitude[i]! > maxMag) maxMag = magnitude[i]!;
  }
  if (maxMag < 1e-10) return 0;

  // Relative floor at -120 dB below peak so silence bins don't corrupt log
  const floor = Math.max(1e-24, maxMag * maxMag * 1e-12);
  let logSum = 0;
  let sum = 0;

  for (let i = start; i < magnitude.length; i++) {
    const power = magnitude[i]! * magnitude[i]! + floor;
    logSum += Math.log(power);
    sum += power;
  }

  const geometricMean = Math.exp(logSum / count);
  const arithmeticMean = sum / count;

  if (arithmeticMean <= floor * 1.01) return 0;
  return Math.min(1.0, Math.max(0.0, geometricMean / arithmeticMean));
}

export interface DetectedSpectralPeak {
  bin: number; // fractional interpolated bin index
  frequency: number; // Hz
  amplitude: number; // true linear sine amplitude
  phase: number; // sine phase in (-π, π] at frame center
}

/**
 * Extracts parabolically-refined spectral peaks using zero-phase centered windowing.
 * Guarantees sub-bin frequency accuracy (< 0.1 Hz for typical FFT sizes), coherent-gain-corrected
 * true sine amplitude, and exact phase at `centerSample`.
 */
export function extractZeroPhaseSpectralPeaks(
  samples: Float32Array,
  centerSample: number,
  sampleRate: number,
  fftSize: number,
  windowSize: number,
  options: {
    minFrequency?: number;
    maxFrequency?: number;
    minAmplitude?: number;
    maxPeaks?: number;
    windowType?: 'hann' | 'blackman-harris' | 'hamming' | 'sqrt-hann' | 'rectangular';
  } = {}
): DetectedSpectralPeak[] {
  const {
    minFrequency = 10,
    maxFrequency = sampleRate / 2,
    minAmplitude = 1e-5,
    maxPeaks = 64,
    windowType = 'hann',
  } = options;

  const actualWinSize = Math.min(fftSize, Math.max(16, windowSize));
  const { window, halfLen, sum: winSum } = createZeroPhaseWindow(actualWinSize, windowType);
  const fft = getCachedFFT(fftSize);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  // Zero-phase circular placement around centerSample:
  // u = 0 .. +halfLen -> real[0 .. halfLen]
  // u = -halfLen .. -1 -> real[fftSize - halfLen .. fftSize - 1]
  for (let u = 0; u <= halfLen; u++) {
    const idx = centerSample + u;
    if (idx >= 0 && idx < samples.length) {
      real[u] = samples[idx]! * window[halfLen + u]!;
    }
  }
  for (let u = -halfLen; u < 0; u++) {
    const idx = centerSample + u;
    if (idx >= 0 && idx < samples.length) {
      real[fftSize + u] = samples[idx]! * window[halfLen + u]!;
    }
  }

  fft.transform(real, imag, false);

  const half = fftSize >> 1;
  const binRes = sampleRate / fftSize;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.hypot(real[k]!, imag[k]!);
  }

  const startBin = Math.max(1, Math.floor(minFrequency / binRes));
  const endBin = Math.min(half - 1, Math.ceil(maxFrequency / binRes));
  const ampScale = winSum > 0 ? 2 / winSum : 2 / fftSize;

  const peaks: DetectedSpectralPeak[] = [];

  for (let k = startBin; k <= endBin; k++) {
    const mPrev = mag[k - 1]!;
    const mCurr = mag[k]!;
    const mNext = mag[k + 1]!;

    if (mCurr > mPrev && mCurr >= mNext && mCurr * ampScale >= minAmplitude) {
      // Parabolic interpolation on log-magnitude spectrum (quadratic interpolation)
      const eps = 1e-20;
      const alpha = Math.log(mPrev + eps);
      const beta = Math.log(mCurr + eps);
      const gamma = Math.log(mNext + eps);
      const denom = alpha - 2 * beta + gamma;
      let delta = 0;
      if (Math.abs(denom) > 1e-12) {
        delta = (0.5 * (alpha - gamma)) / denom;
        delta = Math.max(-0.5, Math.min(0.5, delta));
      }

      const peakBin = k + delta;
      const peakFreq = peakBin * binRes;
      if (peakFreq < minFrequency || peakFreq > maxFrequency) continue;

      const interpLogMag = beta - 0.25 * (alpha - gamma) * delta;
      const interpMag = Math.exp(interpLogMag);
      const amplitude = interpMag * ampScale;

      if (amplitude < minAmplitude) continue;

      // Interpolate unwrapped cosine phase across [k, k + sign(delta)]
      const p0 = Math.atan2(imag[k]!, real[k]!);
      let cosPhase = p0;
      if (Math.abs(delta) > 1e-6) {
        const neighborIdx = delta > 0 ? k + 1 : k - 1;
        const p1 = Math.atan2(imag[neighborIdx]!, real[neighborIdx]!);
        const diff = wrapPhase(p1 - p0);
        cosPhase = wrapPhase(p0 + Math.abs(delta) * diff);
      }

      // Convert cosine phase to sine phase: cos(theta) = sin(theta + pi/2)
      const sinePhase = wrapPhase(cosPhase + HALF_PI);

      peaks.push({
        bin: peakBin,
        frequency: peakFreq,
        amplitude,
        phase: sinePhase,
      });
    }
  }

  // Also check exact Nyquist bin if within maxFrequency
  if (maxFrequency >= sampleRate / 2 - 1e-6) {
    const nyqAmp = mag[half]! / (winSum > 0 ? winSum : fftSize);
    if (nyqAmp >= minAmplitude && nyqAmp > mag[half - 1]! * ampScale) {
      peaks.push({
        bin: half,
        frequency: sampleRate / 2,
        amplitude: nyqAmp,
        phase: real[half]! >= 0 ? HALF_PI : -HALF_PI,
      });
    }
  }

  peaks.sort((a, b) => b.amplitude - a.amplitude);
  return peaks.slice(0, maxPeaks);
}

/**
 * Pure, Web-Worker-compatible comprehensive DSP audio analyzer operating on raw PCM channels.
 */
export function analyzeAudioSamples(
  channels: Float32Array[],
  sampleRate: number
): AudioAnalysisResult {
  const channelCount = Math.max(1, channels.length);
  const samples = channelsToMono(channels);
  const totalSamples = samples.length;
  const duration = sampleRate > 0 ? totalSamples / sampleRate : 0;

  // 1. Peak, RMS, DC offset, Crest factor
  let maxAbs = 0;
  let sumSquares = 0;
  let sumVal = 0;
  for (let i = 0; i < totalSamples; i++) {
    const val = samples[i]!;
    const abs = Math.abs(val);
    if (abs > maxAbs) maxAbs = abs;
    sumSquares += val * val;
    sumVal += val;
  }

  const peakAmplitude = maxAbs;
  const rmsLoudness = totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) : 0;
  const dcOffset = totalSamples > 0 ? sumVal / totalSamples : 0;
  const crestFactor = rmsLoudness > 1e-12 ? peakAmplitude / rmsLoudness : 0;
  const isSilent = peakAmplitude < SILENCE_PEAK_THRESHOLD;

  if (isSilent || totalSamples === 0) {
    return {
      duration,
      sampleRate,
      channelCount,
      sampleLength: totalSamples,
      isSilent: true,
      dcOffset: 0,
      peakAmplitude,
      rmsLoudness,
      crestFactor: 0,
      zeroCrossingRate: 0,
      averageSpectralCentroid: 0,
      tonalVsNoisyScore: 0,
      attackDuration: 0,
      decayDuration: 0,
      startFrequencyEstimate: 0,
      endFrequencyEstimate: 0,
      topSpectralPeaks: [],
      classification: 'silent',
      envelope: [
        { time: 0, amplitude: 0 },
        { time: duration, amplitude: 0 },
      ],
      dominantFrequencies: [],
      explanations: {
        classificationRationale: 'Signal amplitude is below the silence floor (-120 dBFS).',
        tonalRatioExplanation: 'No measurable tonal or noise energy detected.',
        centroidExplanation: 'Spectral centroid is 0 Hz for silent signals.',
        limitations: 'Silence reconstructs trivially as S(t) = 0.',
      },
    };
  }

  // 2. Zero Crossing Rate
  const zeroCrossingRate = calculateZeroCrossingRate(samples);

  // 3. Adaptive STFT analysis that works even for very short clicks/impulses (< 1024 samples)
  const windowSize = Math.min(1024, Math.max(64, nextPowerOf2(Math.min(totalSamples, 1024))));
  const fftSize = Math.max(2048, nextPowerOf2(windowSize * 2));
  const hopSize = Math.max(32, Math.min(256, windowSize >> 2));
  const fft = getCachedFFT(fftSize);
  const hannWin = createWindow(windowSize, 'hann');

  const envelopePoints: EnvelopePoint[] = [];
  const dominantFreqPoints: FrequencyPoint[] = [];

  let weightedCentroidSum = 0;
  let weightedFlatnessSum = 0;
  let energyWeightSum = 0;

  // Center-sampled frames from 0 to totalSamples - 1
  const numFrames = Math.max(1, Math.ceil(totalSamples / hopSize));

  for (let m = 0; m < numFrames; m++) {
    const center = Math.min(totalSamples - 1, m * hopSize);
    const frameTime = center / sampleRate;

    // Fine-resolution RMS around center
    const rmsHalf = Math.max(16, hopSize >> 1);
    const rmsStart = Math.max(0, center - rmsHalf);
    const rmsEnd = Math.min(totalSamples, center + rmsHalf);
    let frameSumSq = 0;
    for (let j = rmsStart; j < rmsEnd; j++) {
      const s = samples[j]!;
      frameSumSq += s * s;
    }
    const frameRms = rmsEnd > rmsStart ? Math.sqrt(frameSumSq / (rmsEnd - rmsStart)) : 0;
    envelopePoints.push({ time: frameTime, amplitude: frameRms });

    // Energy-weighted spectrum features (ignores trailing silence frames!)
    if (frameRms > peakAmplitude * 1e-3) {
      const offset = center - (windowSize >> 1);
      const spectrum = fft.computeNormalizedMagnitudeSpectrum(samples, offset, hannWin);
      const centroid = calculateSpectralCentroid(spectrum, sampleRate);
      const flatness = calculateSpectralFlatness(spectrum);
      const weight = frameRms * frameRms;
      weightedCentroidSum += centroid * weight;
      weightedFlatnessSum += flatness * weight;
      energyWeightSum += weight;

      // Sub-bin dominant peak
      const peaks = extractZeroPhaseSpectralPeaks(
        samples,
        center,
        sampleRate,
        fftSize,
        windowSize,
        {
          minFrequency: 20,
          maxFrequency: Math.min(18000, sampleRate / 2),
          minAmplitude: peakAmplitude * 0.02,
          maxPeaks: 1,
          windowType: 'hann',
        }
      );

      if (peaks.length > 0) {
        const p = peaks[0]!;
        dominantFreqPoints.push({
          time: frameTime,
          frequency: p.frequency,
          magnitude: p.amplitude,
          phase: p.phase,
        });
      }
    }
  }

  const avgCentroid = energyWeightSum > 0 ? weightedCentroidSum / energyWeightSum : 0;
  const avgFlatness = energyWeightSum > 0 ? weightedFlatnessSum / energyWeightSum : 0.5;

  // Tonal vs noisy score based primarily on spectral flatness (Wiener entropy)
  const tonalVsNoisyScore = Math.max(
    0.0,
    Math.min(1.0, (1 - Math.pow(avgFlatness, 0.5)) * 0.8 + (1 - Math.min(1, zeroCrossingRate * 2.5)) * 0.2)
  );

  // 4. High-resolution Attack & Decay timing (1ms resolution via fine envelope)
  let maxEnvVal = 0;
  let peakEnvIdx = 0;
  for (let i = 0; i < totalSamples; i++) {
    const a = Math.abs(samples[i]!);
    if (a > maxEnvVal) {
      maxEnvVal = a;
      peakEnvIdx = i;
    }
  }
  // Find onset (first sample > 5% of peak)
  let onsetIdx = 0;
  const onsetThresh = maxEnvVal * 0.05;
  for (let i = 0; i < totalSamples; i++) {
    if (Math.abs(samples[i]!) >= onsetThresh) {
      onsetIdx = i;
      break;
    }
  }

  const attackDuration = Math.max(0.0005, (peakEnvIdx - onsetIdx) / sampleRate);

  const peakTime = peakEnvIdx / sampleRate;
  const thresholdDecay =
    (envelopePoints.reduce((acc, p) => Math.max(acc, p.amplitude), 0) || rmsLoudness) * 0.1;
  let decayEndTime = duration;
  for (const pt of envelopePoints) {
    if (pt.time > peakTime && pt.amplitude <= thresholdDecay) {
      decayEndTime = pt.time;
      break;
    }
  }
  const decayDuration = Math.max(0.005, decayEndTime - peakTime);

  // 5. Global prominent spectral peaks (from center of max-energy region using large zero-phase FFT)
  const globalWin = Math.min(4096, Math.max(64, totalSamples));
  const globalFftSize = Math.max(4096, nextPowerOf2(globalWin * 2));
  const globalCenter = Math.min(
    totalSamples - 1,
    Math.max(0, Math.round(totalSamples * 0.5))
  );
  // If transient/decaying, analyze around peak energy region instead of dead tail
  const analysisCenter =
    decayDuration < duration * 0.4 ? Math.min(totalSamples - 1, peakEnvIdx + Math.min(globalWin >> 2, (totalSamples - peakEnvIdx) >> 1)) : globalCenter;

  const globalPeaks = extractZeroPhaseSpectralPeaks(
    samples,
    analysisCenter,
    sampleRate,
    globalFftSize,
    globalWin,
    {
      minFrequency: 15,
      maxFrequency: sampleRate / 2,
      minAmplitude: peakAmplitude * 0.01,
      maxPeaks: 12,
      windowType: 'hann',
    }
  );

  const topSpectralPeaks: SpectralPeakSummary[] = globalPeaks.map((p) => ({
    frequency: p.frequency,
    amplitude: p.amplitude,
    phase: p.phase,
  }));

  // 6. Frequency Trajectory (Sweep Start & End)
  let startFreqEstimate = topSpectralPeaks[0]?.frequency ?? Math.min(4000, Math.max(80, avgCentroid));
  let endFreqEstimate = startFreqEstimate;

  if (dominantFreqPoints.length >= 2) {
    const sortedByTime = [...dominantFreqPoints].sort((a, b) => a.time - b.time);
    const qLen = Math.max(1, Math.floor(sortedByTime.length * 0.2));
    const firstSlice = sortedByTime.slice(0, qLen);
    const lastSlice = sortedByTime.slice(sortedByTime.length - qLen);

    startFreqEstimate = firstSlice.reduce((s, p) => s + p.frequency, 0) / firstSlice.length;
    endFreqEstimate = lastSlice.reduce((s, p) => s + p.frequency, 0) / lastSlice.length;
  } else if (dominantFreqPoints.length === 1) {
    startFreqEstimate = dominantFreqPoints[0]!.frequency;
    endFreqEstimate = startFreqEstimate;
  }

  // 7. Classification Heuristic
  let classification: SoundClassification = 'mixed';
  let rationale = '';

  const isImpulseOrClick = crestFactor > 7.5 && decayDuration < 0.12;
  const isFastAttack = attackDuration < 0.02;
  const isShortDecay = decayDuration < 0.22;
  const isHighNoise = avgFlatness > 0.35 || tonalVsNoisyScore < 0.38;
  const isStrongTonal = avgFlatness < 0.12 && tonalVsNoisyScore > 0.65;

  if (isImpulseOrClick || (isFastAttack && isShortDecay && !isStrongTonal)) {
    classification = 'percussive';
    rationale = `Sharp transient onset (${(attackDuration * 1000).toFixed(1)}ms attack, crest ${crestFactor.toFixed(1)}, ${(decayDuration * 1000).toFixed(0)}ms decay).`;
  } else if (isHighNoise) {
    classification = 'noisy';
    rationale = `Broadband / noisy spectrum (spectral flatness ${(avgFlatness * 100).toFixed(0)}%, ZCR ${(zeroCrossingRate * 100).toFixed(1)}%).`;
  } else if (isStrongTonal) {
    classification = 'tonal';
    rationale = `Strong harmonic peaks centered near ${Math.round(startFreqEstimate)} Hz (flatness ${(avgFlatness * 100).toFixed(1)}%).`;
  } else {
    classification = 'mixed';
    rationale = `Combination of harmonic structure (~${Math.round(startFreqEstimate)} Hz) and transient/broadband energy.`;
  }

  return {
    duration,
    sampleRate,
    channelCount,
    sampleLength: totalSamples,
    isSilent: false,
    dcOffset,
    peakAmplitude,
    rmsLoudness,
    crestFactor,
    zeroCrossingRate,
    averageSpectralCentroid: avgCentroid,
    tonalVsNoisyScore,
    attackDuration,
    decayDuration,
    startFrequencyEstimate: startFreqEstimate,
    endFrequencyEstimate: endFreqEstimate,
    topSpectralPeaks,
    classification,
    envelope: envelopePoints,
    dominantFrequencies: dominantFreqPoints,
    explanations: {
      classificationRationale: rationale,
      tonalRatioExplanation:
        'Derived from Wiener spectral flatness (geometric/arithmetic power ratio) and zero-crossing rate. Near 100% indicates discrete sinusoids; near 0% indicates wideband noise.',
      centroidExplanation:
        'Spectral centroid is the amplitude-weighted frequency center of mass in Hertz.',
      limitations:
        'Broadband noise, explosions, and sharp impulses require many Fourier sinusoids for exact fidelity; compact procedural equations approximate their envelope and spectral contour.',
    },
  };
}

/**
 * Convenience wrapper analyzing a Web Audio API AudioBuffer.
 */
export function analyzeAudioBuffer(
  audioBuffer: AudioBuffer,
  channelCount = audioBuffer.numberOfChannels
): AudioAnalysisResult {
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(channelCount, audioBuffer.numberOfChannels); c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  return analyzeAudioSamples(channels, audioBuffer.sampleRate);
}
