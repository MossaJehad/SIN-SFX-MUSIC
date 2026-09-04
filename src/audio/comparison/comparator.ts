import { AudioAnalysisResult, EnvelopePoint } from '@/types/analysis';

export interface ComparisonMetrics {
  approximationScore: number; // 0..100 (%)
  envelopeSimilarity: number; // 0..100 (%)
  spectralSimilarity: number; // 0..100 (%)
  timbreSimilarity: number; // 0..100 (%)
  durationDifferenceSeconds: number;
  label: string;
}

/**
 * Compares two downsampled amplitude envelopes using Mean Absolute Error.
 */
export function compareEnvelopes(
  envA: EnvelopePoint[],
  envB: EnvelopePoint[],
  targetPoints = 32
): number {
  if (envA.length === 0 || envB.length === 0) return 0.5;

  let totalDiff = 0;
  for (let i = 0; i < targetPoints; i++) {
    const normTime = i / (targetPoints - 1);

    // Interpolate amp A
    const ampA = interpolateEnvelopeAtNormTime(envA, normTime);
    // Interpolate amp B
    const ampB = interpolateEnvelopeAtNormTime(envB, normTime);

    totalDiff += Math.abs(ampA - ampB);
  }

  const meanError = totalDiff / targetPoints;
  return Math.max(0, Math.min(1, 1 - meanError * 1.5));
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
 * Calculates a multi-feature approximation score between original audio features and procedural output.
 * Note: Labeled clearly as an algorithmic approximation score, not perceptual ground truth.
 */
export function calculateApproximationScore(
  orig: AudioAnalysisResult,
  proc: AudioAnalysisResult
): ComparisonMetrics {
  // 1. Envelope similarity (temporal loudness contour)
  const envSim = compareEnvelopes(orig.envelope, proc.envelope);

  // 2. Spectral centroid similarity (log-frequency brightness match)
  const origCentroidLog = Math.log2(Math.max(40, orig.averageSpectralCentroid));
  const procCentroidLog = Math.log2(Math.max(40, proc.averageSpectralCentroid));
  const maxOctaveDiff = 4; // 4 octaves difference = 0 score
  const centroidDiff = Math.abs(origCentroidLog - procCentroidLog);
  const spectralSim = Math.max(0, 1 - centroidDiff / maxOctaveDiff);

  // 3. Timbre / Tonal-versus-noise ratio match
  const tonalDiff = Math.abs(orig.tonalVsNoisyScore - proc.tonalVsNoisyScore);
  const zcrDiff = Math.abs(orig.zeroCrossingRate - proc.zeroCrossingRate);
  const timbreSim = Math.max(0, 1 - (tonalDiff * 0.6 + zcrDiff * 0.4));

  // 4. Duration match
  const durDiff = Math.abs(orig.duration - proc.duration);
  const durFactor = Math.max(0, 1 - durDiff / Math.max(0.2, orig.duration));

  // Weighted total
  const weighted = envSim * 0.4 + spectralSim * 0.25 + timbreSim * 0.25 + durFactor * 0.1;
  const scorePercent = Math.round(Math.max(10, Math.min(99, weighted * 100)));

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
