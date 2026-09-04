import { describe, it, expect } from 'vitest';
import { compareEnvelopes, calculateApproximationScore } from './comparator';
import { AudioAnalysisResult, EnvelopePoint } from '@/types/analysis';

describe('Audio Comparator & Approximation Score', () => {
  it('yields 100% envelope similarity for identical envelopes', () => {
    const env: EnvelopePoint[] = [
      { time: 0, amplitude: 0 },
      { time: 0.05, amplitude: 1 },
      { time: 0.2, amplitude: 0.1 },
      { time: 0.3, amplitude: 0 },
    ];
    const score = compareEnvelopes(env, env);
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('calculates bounded approximation score between two analyses', () => {
    const orig: AudioAnalysisResult = {
      duration: 0.25,
      sampleRate: 44100,
      channelCount: 1,
      peakAmplitude: 0.9,
      rmsLoudness: 0.3,
      zeroCrossingRate: 0.08,
      averageSpectralCentroid: 1200,
      tonalVsNoisyScore: 0.85,
      attackDuration: 0.005,
      decayDuration: 0.15,
      startFrequencyEstimate: 440,
      endFrequencyEstimate: 440,
      classification: 'tonal',
      envelope: [
        { time: 0, amplitude: 0 },
        { time: 0.005, amplitude: 0.9 },
        { time: 0.2, amplitude: 0.05 },
      ],
      dominantFrequencies: [{ time: 0.05, frequency: 440, magnitude: 0.8 }],
      explanations: {
        classificationRationale: 'Tonal sound',
        tonalRatioExplanation: 'Tonal',
        centroidExplanation: '1200Hz',
        limitations: 'None',
      },
    };

    const proc = { ...orig };

    const metrics = calculateApproximationScore(orig, proc);
    expect(metrics.approximationScore).toBeGreaterThanOrEqual(90);
    expect(metrics.envelopeSimilarity).toBeGreaterThanOrEqual(95);
    expect(metrics.spectralSimilarity).toBeGreaterThanOrEqual(95);
  });
});
