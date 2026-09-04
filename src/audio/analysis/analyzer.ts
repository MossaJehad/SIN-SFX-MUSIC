import {
  AudioAnalysisResult,
  EnvelopePoint,
  FrequencyPoint,
  SoundClassification,
} from '@/types/analysis';
import { LightweightFFT } from './fft';

/**
 * Converts any multi-channel audio buffer to a normalized mono Float32Array.
 */
export function audioBufferToMono(buffer: AudioBuffer): Float32Array {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const mono = new Float32Array(length);

  if (numChannels === 1) {
    mono.set(buffer.getChannelData(0));
    return mono;
  }

  // Downmix to mono by averaging all channels
  for (let c = 0; c < numChannels; c++) {
    const channelData = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      mono[i] = (mono[i] ?? 0) + (channelData[i] ?? 0) / numChannels;
    }
  }

  return mono;
}

/**
 * Calculates Zero-Crossing Rate (ZCR) across the signal.
 * High ZCR (> 0.2) indicates high-frequency unpitched noise or sharp transients.
 * Low ZCR (< 0.08) indicates low/mid fundamental tonal content.
 */
export function calculateZeroCrossingRate(samples: Float32Array): number {
  if (samples.length < 2) return 0;
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
 * Calculates Spectral Centroid (frequency "center of mass") from a magnitude spectrum.
 */
export function calculateSpectralCentroid(magnitude: Float32Array, sampleRate: number): number {
  let weightedSum = 0;
  let totalMagnitude = 0;
  const nyquist = sampleRate / 2;
  const binWidth = nyquist / magnitude.length;

  for (let i = 0; i < magnitude.length; i++) {
    const mag = magnitude[i]!;
    const freq = i * binWidth;
    weightedSum += freq * mag;
    totalMagnitude += mag;
  }

  return totalMagnitude > 0.0001 ? weightedSum / totalMagnitude : 0;
}

/**
 * Calculates Spectral Flatness (Wiener entropy) from magnitude spectrum.
 * Ratio of geometric mean to arithmetic mean.
 * Values close to 1.0 indicate white noise, while values near 0.0 indicate pure tones.
 */
export function calculateSpectralFlatness(magnitude: Float32Array): number {
  let logSum = 0;
  let sum = 0;
  const count = magnitude.length;
  if (count === 0) return 0;

  const epsilon = 1e-10;

  for (let i = 0; i < count; i++) {
    const power = magnitude[i]! * magnitude[i]! + epsilon;
    logSum += Math.log(power);
    sum += power;
  }

  const geometricMean = Math.exp(logSum / count);
  const arithmeticMean = sum / count;

  if (arithmeticMean <= epsilon) return 0;
  return Math.min(1.0, Math.max(0.0, geometricMean / arithmeticMean));
}

/**
 * Comprehensive browser-based audio analyzer for game sound effects.
 */
export function analyzeAudioBuffer(
  audioBuffer: AudioBuffer,
  channelCount = audioBuffer.numberOfChannels
): AudioAnalysisResult {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const samples = audioBufferToMono(audioBuffer);
  const totalSamples = samples.length;

  // 1. Peak & RMS
  let maxAbs = 0;
  let sumSquares = 0;
  for (let i = 0; i < totalSamples; i++) {
    const val = samples[i]!;
    const abs = Math.abs(val);
    if (abs > maxAbs) maxAbs = abs;
    sumSquares += val * val;
  }
  const peakAmplitude = maxAbs;
  const rmsLoudness = totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) : 0;

  // 2. Zero Crossing Rate
  const zeroCrossingRate = calculateZeroCrossingRate(samples);

  // 3. Frame-based FFT analysis (20ms frames, 50% overlap)
  const fftSize = 1024;
  const hopSize = 512;
  const fft = new LightweightFFT(fftSize);
  const binResolution = sampleRate / 2 / (fftSize / 2);

  const envelopePoints: EnvelopePoint[] = [];
  const dominantFreqPoints: FrequencyPoint[] = [];

  let sumCentroid = 0;
  let sumFlatness = 0;
  let frameCount = 0;

  for (let offset = 0; offset + fftSize <= totalSamples; offset += hopSize) {
    const frameTime = offset / sampleRate;

    // RMS of this frame for envelope
    let frameSumSq = 0;
    for (let j = 0; j < hopSize; j++) {
      const s = samples[offset + j]!;
      frameSumSq += s * s;
    }
    const frameRms = Math.sqrt(frameSumSq / hopSize);
    envelopePoints.push({
      time: frameTime,
      amplitude: frameRms,
    });

    // FFT Spectrum
    const spectrum = fft.computeMagnitudeSpectrum(samples, offset);
    const centroid = calculateSpectralCentroid(spectrum, sampleRate);
    const flatness = calculateSpectralFlatness(spectrum);

    sumCentroid += centroid;
    sumFlatness += flatness;
    frameCount++;

    // Find dominant peak (ignore very low rumble < 40 Hz)
    let maxMag = 0;
    let peakBin = 0;
    const startBin = Math.max(1, Math.floor(40 / binResolution));
    const endBin = Math.min(spectrum.length - 1, Math.floor(12000 / binResolution));

    for (let b = startBin; b <= endBin; b++) {
      const mag = spectrum[b]!;
      if (mag > maxMag) {
        maxMag = mag;
        peakBin = b;
      }
    }

    if (maxMag > 0.01) {
      dominantFreqPoints.push({
        time: frameTime,
        frequency: peakBin * binResolution,
        magnitude: maxMag,
      });
    }
  }

  const avgCentroid = frameCount > 0 ? sumCentroid / frameCount : 1000;
  const avgFlatness = frameCount > 0 ? sumFlatness / frameCount : 0.5;

  // Tonal vs noisy score: Inverted spectral flatness combined with ZCR factor
  // 1.0 = highly tonal (pure sine/triangle), 0.0 = white/colored noise
  const tonalVsNoisyScore = Math.max(
    0.0,
    Math.min(1.0, (1 - avgFlatness) * 0.7 + (1 - Math.min(1, zeroCrossingRate * 3)) * 0.3)
  );

  // 4. Attack & Decay Timing
  let maxEnvelope = 0;
  let peakTime = 0;
  for (const pt of envelopePoints) {
    if (pt.amplitude > maxEnvelope) {
      maxEnvelope = pt.amplitude;
      peakTime = pt.time;
    }
  }

  const attackDuration = Math.max(0.001, peakTime);
  const thresholdDecay = maxEnvelope * 0.1; // -20 dB down
  let decayEndTime = duration;

  for (const pt of envelopePoints) {
    if (pt.time > peakTime && pt.amplitude <= thresholdDecay) {
      decayEndTime = pt.time;
      break;
    }
  }
  const decayDuration = Math.max(0.01, decayEndTime - peakTime);

  // 5. Frequency Trajectory (Sweep Start & End)
  let startFreqEstimate = 440;
  let endFreqEstimate = 440;

  if (dominantFreqPoints.length > 0) {
    const sortedByTime = [...dominantFreqPoints].sort((a, b) => a.time - b.time);
    const firstQuarter = sortedByTime.slice(0, Math.max(1, Math.floor(sortedByTime.length * 0.25)));
    const lastQuarter = sortedByTime.slice(Math.floor(sortedByTime.length * 0.75));

    if (firstQuarter.length > 0) {
      const sumF = firstQuarter.reduce((acc, p) => acc + p.frequency, 0);
      startFreqEstimate = sumF / firstQuarter.length;
    }
    if (lastQuarter.length > 0) {
      const sumF = lastQuarter.reduce((acc, p) => acc + p.frequency, 0);
      endFreqEstimate = sumF / lastQuarter.length;
    } else {
      endFreqEstimate = startFreqEstimate;
    }
  } else {
    // If no distinct peak found, use centroid
    startFreqEstimate = Math.min(4000, Math.max(100, avgCentroid * 0.5));
    endFreqEstimate = startFreqEstimate;
  }

  // 6. Classification Heuristic
  let classification: SoundClassification = 'mixed';
  let rationale = '';

  const isFastAttack = attackDuration < 0.025;
  const isShortDecay = decayDuration < 0.25;
  const isHighNoise = tonalVsNoisyScore < 0.35 || zeroCrossingRate > 0.16;
  const isStrongTonal = tonalVsNoisyScore > 0.65 && zeroCrossingRate < 0.12;

  if (isHighNoise && !isFastAttack) {
    classification = 'noisy';
    rationale =
      'Dominated by high spectral flatness and zero-crossing rate with dispersed frequencies.';
  } else if (isFastAttack && isShortDecay) {
    classification = 'percussive';
    rationale = `Fast onset attack (${(attackDuration * 1000).toFixed(1)}ms) and rapid exponential decay (${(decayDuration * 1000).toFixed(1)}ms).`;
  } else if (isStrongTonal) {
    classification = 'tonal';
    rationale = `Prominent fundamental harmonic peaks detected (tonal score: ${(tonalVsNoisyScore * 100).toFixed(0)}%).`;
  } else {
    classification = 'mixed';
    rationale =
      'Contains identifiable harmonic center layered with transient attack noise or background noise.';
  }

  return {
    duration,
    sampleRate,
    channelCount,
    peakAmplitude,
    rmsLoudness,
    zeroCrossingRate,
    averageSpectralCentroid: avgCentroid,
    tonalVsNoisyScore,
    attackDuration,
    decayDuration,
    startFrequencyEstimate: startFreqEstimate,
    endFrequencyEstimate: endFreqEstimate,
    classification,
    envelope: envelopePoints,
    dominantFrequencies: dominantFreqPoints,
    explanations: {
      classificationRationale: rationale,
      tonalRatioExplanation:
        'Calculated from spectral flatness and zero-crossing rate. A score near 100% indicates clear musical tones, while near 0% indicates wideband noise.',
      centroidExplanation:
        'Spectral centroid measures the brightness center of the sound in Hertz. Higher values indicate crisper, brighter sounds.',
      limitations:
        'Browser-based single-pass STFT analysis is optimized for short game sound effects (< 3s). It does not separate speech, polyphonic music, or multi-timbral instruments.',
    },
  };
}
