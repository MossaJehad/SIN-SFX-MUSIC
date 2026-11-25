import { AudioAnalysisResult, EnvelopePoint } from '@/types/analysis';
import { ReconstructionMetrics, SpectrogramData, SpectrumData } from '@/types/mathModel';
import { createWindow, getCachedFFT } from '@/audio/analysis/fft';
import { channelsToMono, SILENCE_PEAK_THRESHOLD } from '@/audio/analysis/analyzer';

export interface ComparisonMetrics {
  approximationScore: number; // 0..100 (%)
  envelopeSimilarity: number; // 0..100 (%)
  spectralSimilarity: number; // 0..100 (%)
  timbreSimilarity: number; // 0..100 (%)
  durationDifferenceSeconds: number;
  label: string;
}

/**
 * Compares two amplitude envelopes using peak-normalized Mean Absolute Error.
 * Correctly handles silent envelopes without fabricating 50% scores.
 */
export function compareEnvelopes(
  envA: EnvelopePoint[],
  envB: EnvelopePoint[],
  targetPoints = 32
): number {
  if (envA.length === 0 && envB.length === 0) return 1.0;
  if (envA.length === 0 || envB.length === 0) return 0.0;

  const maxA = envA.reduce((m, p) => Math.max(m, p.amplitude), 0);
  const maxB = envB.reduce((m, p) => Math.max(m, p.amplitude), 0);

  if (maxA < SILENCE_PEAK_THRESHOLD && maxB < SILENCE_PEAK_THRESHOLD) return 1.0;
  if (maxA < SILENCE_PEAK_THRESHOLD || maxB < SILENCE_PEAK_THRESHOLD) return 0.0;

  let totalDiff = 0;
  for (let i = 0; i < targetPoints; i++) {
    const normTime = i / (targetPoints - 1);
    const ampA = interpolateEnvelopeAtNormTime(envA, normTime) / maxA;
    const ampB = interpolateEnvelopeAtNormTime(envB, normTime) / maxB;
    totalDiff += Math.abs(ampA - ampB);
  }

  const meanError = totalDiff / targetPoints;
  return Math.max(0, Math.min(1, 1 - meanError));
}

function interpolateEnvelopeAtNormTime(env: EnvelopePoint[], normTime: number): number {
  if (env.length === 0) return 0;
  const maxTime = env[env.length - 1]!.time || 1;
  const targetTime = normTime * maxTime;

  for (let i = 0; i < env.length - 1; i++) {
    const cur = env[i]!;
    const next = env[i + 1]!;
    if (targetTime >= cur.time && targetTime <= next.time) {
      const span = next.time - cur.time;
      if (span <= 0) return cur.amplitude;
      const factor = (targetTime - cur.time) / span;
      return cur.amplitude + factor * (next.amplitude - cur.amplitude);
    }
  }

  return env[env.length - 1]!.amplitude;
}

/**
 * Computes Pearson correlation coefficient between two RMS envelopes in [-1, 1].
 */
function computeEnvelopePearson(origMono: Float32Array, reconMono: Float32Array): number {
  const len = Math.max(origMono.length, reconMono.length);
  if (len === 0) return 1;

  const numBins = Math.min(128, Math.max(8, Math.floor(len / 32)));
  const envA = new Float64Array(numBins);
  const envB = new Float64Array(numBins);

  for (let b = 0; b < numBins; b++) {
    const s0 = Math.floor((b * len) / numBins);
    const s1 = Math.max(s0 + 1, Math.floor(((b + 1) * len) / numBins));
    let sqA = 0;
    let sqB = 0;
    for (let i = s0; i < s1; i++) {
      const a = i < origMono.length ? origMono[i]! : 0;
      const r = i < reconMono.length ? reconMono[i]! : 0;
      sqA += a * a;
      sqB += r * r;
    }
    envA[b] = Math.sqrt(sqA / (s1 - s0));
    envB[b] = Math.sqrt(sqB / (s1 - s0));
  }

  let meanA = 0;
  let meanB = 0;
  for (let b = 0; b < numBins; b++) {
    meanA += envA[b]!;
    meanB += envB[b]!;
  }
  meanA /= numBins;
  meanB /= numBins;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let b = 0; b < numBins; b++) {
    const da = envA[b]! - meanA;
    const db = envB[b]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  // Handle flat constant envelopes (e.g. steady sine wave has near-zero envelope variance!)
  if (varA < 1e-12 && varB < 1e-12) {
    const maxMean = Math.max(meanA, meanB, 1e-12);
    return Math.max(0, 1 - Math.abs(meanA - meanB) / maxMean);
  }
  if (varA < 1e-12 || varB < 1e-12) return 0;

  return Math.max(-1, Math.min(1, cov / Math.sqrt(varA * varB)));
}

/**
 * Computes real sample-by-sample waveform metrics, Log-Spectral Distance (dB),
 * averaged magnitude spectra, spectrograms, and difference waveform between
 * original and reconstructed signals (must share the same sampleRate).
 */
export function compareAudioSignals(
  originalChannels: Float32Array[],
  reconstructedChannels: Float32Array[],
  sampleRate: number
): { metrics: ReconstructionMetrics; differenceChannels: Float32Array[] } {
  const numChannels = Math.max(1, originalChannels.length, reconstructedChannels.length);
  const origLen = originalChannels[0]?.length ?? 0;
  const reconLen = reconstructedChannels[0]?.length ?? 0;
  const maxLen = Math.max(origLen, reconLen);

  const differenceChannels: Float32Array[] = [];

  let sumSqOrig = 0;
  let sumSqRecon = 0;
  let sumSqErr = 0;
  let peakAbsErr = 0;
  let origPeak = 0;
  let reconPeak = 0;
  let clippedSamples = 0;
  const totalSamplesAllCh = maxLen * numChannels;

  for (let c = 0; c < numChannels; c++) {
    const orig = originalChannels[Math.min(c, originalChannels.length - 1)] ?? new Float32Array(0);
    const recon =
      reconstructedChannels[Math.min(c, reconstructedChannels.length - 1)] ?? new Float32Array(0);
    const diff = new Float32Array(maxLen);

    for (let i = 0; i < maxLen; i++) {
      const o = i < orig.length ? orig[i]! : 0;
      const r = i < recon.length ? recon[i]! : 0;
      const e = o - r;
      diff[i] = e;

      sumSqOrig += o * o;
      sumSqRecon += r * r;
      sumSqErr += e * e;

      const absO = Math.abs(o);
      const absR = Math.abs(r);
      const absE = Math.abs(e);
      if (absO > origPeak) origPeak = absO;
      if (absR > reconPeak) reconPeak = absR;
      if (absE > peakAbsErr) peakAbsErr = absE;
      if (absR > 1.0 + 1e-6) clippedSamples++;
    }

    differenceChannels.push(diff);
  }

  const rmse = totalSamplesAllCh > 0 ? Math.sqrt(sumSqErr / totalSamplesAllCh) : 0;
  const originalRms = totalSamplesAllCh > 0 ? Math.sqrt(sumSqOrig / totalSamplesAllCh) : 0;
  const reconstructedRms = totalSamplesAllCh > 0 ? Math.sqrt(sumSqRecon / totalSamplesAllCh) : 0;
  const isOrigSilent = origPeak < SILENCE_PEAK_THRESHOLD;
  const isReconSilent = reconPeak < SILENCE_PEAK_THRESHOLD;
  const isExactSilenceMatch = isOrigSilent && isReconSilent;

  let relativeL2Error = 0;
  let snrDb = 0;
  if (isExactSilenceMatch) {
    relativeL2Error = 0;
    snrDb = Infinity;
  } else if (isOrigSilent) {
    relativeL2Error = Infinity;
    snrDb = -Infinity;
  } else if (sumSqErr < 1e-28) {
    relativeL2Error = 0;
    snrDb = Infinity;
  } else {
    relativeL2Error = Math.sqrt(sumSqErr / sumSqOrig);
    snrDb = 10 * Math.log10(sumSqOrig / sumSqErr);
  }

  // Compute Log-Spectral Distance (LSD in dB), averaged Spectrum, and Spectrogram
  const origMono = channelsToMono(originalChannels);
  const reconMono = channelsToMono(reconstructedChannels);
  const { lsdDb, spectrum, spectrogram } = computeSpectralComparison(
    origMono,
    reconMono,
    sampleRate,
    maxLen
  );

  const envelopeCorrelation = isExactSilenceMatch
    ? 1.0
    : computeEnvelopePearson(origMono, reconMono);

  const durationDifferenceSeconds = Math.abs(origLen - reconLen) / Math.max(1, sampleRate);

  // Real derived indicators (never clamped falsely to [10, 99])
  const envSimPct = Math.round(Math.max(0, Math.min(100, ((envelopeCorrelation + 1) / 2) * 100)));
  // Map LSD (0 dB = 100%, 40 dB = 0%) cleanly
  const specSimPct = isExactSilenceMatch
    ? 100
    : Math.round(Math.max(0, Math.min(100, (1 - lsdDb / 35) * 100)));
  // Map SNR (-10 dB..60 dB) into waveform fidelity indicator
  const snrSimPct = !Number.isFinite(snrDb)
    ? snrDb > 0
      ? 100
      : 0
    : Math.round(Math.max(0, Math.min(100, ((snrDb + 5) / 55) * 100)));

  const compositeScore = Math.round(snrSimPct * 0.45 + specSimPct * 0.35 + envSimPct * 0.2);

  let label = 'Low Fidelity Approximation';
  if (snrDb >= 80 || isExactSilenceMatch) label = 'Exact Numerical Match';
  else if (snrDb >= 25 && lsdDb <= 5) label = 'High-Fidelity Reconstruction';
  else if (snrDb >= 12 || lsdDb <= 9) label = 'Recognizable Optimized Match';
  else if (lsdDb <= 16) label = 'Compact Approximation';

  return {
    differenceChannels,
    metrics: {
      rmse,
      peakAbsoluteError: peakAbsErr,
      relativeL2Error,
      snrDb,
      logSpectralDistanceDb: lsdDb,
      envelopeCorrelation,
      durationDifferenceSeconds,
      originalPeak: origPeak,
      reconstructedPeak: reconPeak,
      clippedSamples,
      originalRms,
      reconstructedRms,
      isExactSilenceMatch,
      spectrum,
      spectrogram,
      envelopeSimilarity: envSimPct,
      spectralSimilarity: specSimPct,
      timbreSimilarity: snrSimPct,
      approximationScore: compositeScore,
      label,
    },
  };
}

function computeSpectralComparison(
  origMono: Float32Array,
  reconMono: Float32Array,
  sampleRate: number,
  maxLen: number
): { lsdDb: number; spectrum: SpectrumData; spectrogram: SpectrogramData } {
  const fftSize = 512;
  const half = fftSize >> 1;
  const numBins = half + 1;
  const fft = getCachedFFT(fftSize);
  const win = createWindow(fftSize, 'hann');

  // Target at most 160 spectrogram frames for fast rendering & memory efficiency
  const rawHop = Math.max(64, Math.floor(maxLen / 120));
  const hopSize = Math.min(fftSize >> 1, Math.max(64, rawHop));
  const numFrames = Math.max(1, Math.min(160, Math.ceil(Math.max(1, maxLen) / hopSize)));
  const frameStep = maxLen > fftSize ? (maxLen - fftSize) / Math.max(1, numFrames - 1) : 0;

  const frequencies = new Float32Array(numBins);
  const binRes = sampleRate / fftSize;
  for (let k = 0; k < numBins; k++) frequencies[k] = k * binRes;

  const avgOrigPow = new Float64Array(numBins);
  const avgReconPow = new Float64Array(numBins);
  const specOrigDb = new Float32Array(numFrames * numBins);
  const specReconDb = new Float32Array(numFrames * numBins);

  const powerFloor = 1e-10; // -100 dB floor
  let lsdFrameSum = 0;
  let activeLsdFrames = 0;

  for (let m = 0; m < numFrames; m++) {
    const offset = Math.round(m * frameStep);
    const magOrig = fft.computeNormalizedMagnitudeSpectrum(origMono, offset, win);
    const magRecon = fft.computeNormalizedMagnitudeSpectrum(reconMono, offset, win);

    let frameMaxPow = 0;
    let frameSqLogDiff = 0;
    const baseIdx = m * numBins;

    for (let k = 0; k < numBins; k++) {
      const pO = magOrig[k]! * magOrig[k]!;
      const pR = magRecon[k]! * magRecon[k]!;
      if (pO > frameMaxPow) frameMaxPow = pO;
      if (pR > frameMaxPow) frameMaxPow = pR;

      avgOrigPow[k] = avgOrigPow[k]! + pO;
      avgReconPow[k] = avgReconPow[k]! + pR;

      const dbO = 10 * Math.log10(pO + powerFloor);
      const dbR = 10 * Math.log10(pR + powerFloor);
      specOrigDb[baseIdx + k] = Math.max(-100, dbO);
      specReconDb[baseIdx + k] = Math.max(-100, dbR);

      const diffDb = dbO - dbR;
      frameSqLogDiff += diffDb * diffDb;
    }

    if (frameMaxPow > powerFloor * 10) {
      lsdFrameSum += Math.sqrt(frameSqLogDiff / numBins);
      activeLsdFrames++;
    }
  }

  const lsdDb = activeLsdFrames > 0 ? lsdFrameSum / activeLsdFrames : 0;

  const originalDb = new Float32Array(numBins);
  const reconstructedDb = new Float32Array(numBins);
  for (let k = 0; k < numBins; k++) {
    originalDb[k] = Math.max(-100, 10 * Math.log10(avgOrigPow[k]! / numFrames + powerFloor));
    reconstructedDb[k] = Math.max(-100, 10 * Math.log10(avgReconPow[k]! / numFrames + powerFloor));
  }

  return {
    lsdDb,
    spectrum: {
      frequencies,
      originalDb,
      reconstructedDb,
    },
    spectrogram: {
      numFrames,
      numBins,
      maxFreqHz: sampleRate / 2,
      duration: maxLen / Math.max(1, sampleRate),
      originalDb: specOrigDb,
      reconstructedDb: specReconDb,
    },
  };
}

/**
 * Feature-based comparison helper retained for backward compatibility with manual recipe comparisons.
 * Does NOT clamp falsely to [10, 99].
 */
export function calculateApproximationScore(
  orig: AudioAnalysisResult,
  proc: AudioAnalysisResult
): ComparisonMetrics {
  const envSim = compareEnvelopes(orig.envelope, proc.envelope);

  const origCentroidLog = Math.log2(Math.max(40, orig.averageSpectralCentroid));
  const procCentroidLog = Math.log2(Math.max(40, proc.averageSpectralCentroid));
  const maxOctaveDiff = 4;
  const centroidDiff = Math.abs(origCentroidLog - procCentroidLog);
  const spectralSim = Math.max(0, 1 - centroidDiff / maxOctaveDiff);

  const tonalDiff = Math.abs(orig.tonalVsNoisyScore - proc.tonalVsNoisyScore);
  const zcrDiff = Math.abs(orig.zeroCrossingRate - proc.zeroCrossingRate);
  const timbreSim = Math.max(0, 1 - (tonalDiff * 0.6 + zcrDiff * 0.4));

  const durDiff = Math.abs(orig.duration - proc.duration);
  const durFactor = Math.max(0, 1 - durDiff / Math.max(0.05, orig.duration));

  const weighted = envSim * 0.4 + spectralSim * 0.25 + timbreSim * 0.25 + durFactor * 0.1;
  const scorePercent = Math.round(Math.max(0, Math.min(100, weighted * 100)));

  let label = 'Fair Approximation';
  if (scorePercent >= 85) label = 'Close Approximation';
  else if (scorePercent >= 70) label = 'Good Approximation';
  else if (scorePercent < 45) label = 'Rough Approximation';

  return {
    approximationScore: scorePercent,
    envelopeSimilarity: Math.round(envSim * 100),
    spectralSimilarity: Math.round(spectralSim * 100),
    timbreSimilarity: Math.round(timbreSim * 100),
    durationDifferenceSeconds: durDiff,
    label,
  };
}
