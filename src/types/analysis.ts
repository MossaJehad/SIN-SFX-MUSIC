export type SoundClassification = 'tonal' | 'percussive' | 'noisy' | 'mixed';

export interface EnvelopePoint {
  time: number; // in seconds
  amplitude: number; // normalized 0..1
}

export interface FrequencyPoint {
  time: number; // in seconds
  frequency: number; // dominant frequency in Hz
  magnitude: number; // relative magnitude 0..1
}

export interface AudioAnalysisResult {
  duration: number; // in seconds
  sampleRate: number; // in Hz
  channelCount: number; // original channel count
  peakAmplitude: number; // absolute peak [0..1]
  rmsLoudness: number; // overall RMS power [0..1]
  zeroCrossingRate: number; // normalized zero-crossing rate [0..1]
  averageSpectralCentroid: number; // perceived brightness center in Hz
  tonalVsNoisyScore: number; // 0.0 (pure noise) to 1.0 (pure tonal)
  attackDuration: number; // time from onset to envelope peak in seconds
  decayDuration: number; // time from envelope peak to -20dB in seconds
  startFrequencyEstimate: number; // starting dominant frequency in Hz
  endFrequencyEstimate: number; // ending dominant frequency in Hz
  classification: SoundClassification;
  envelope: EnvelopePoint[]; // downsampled amplitude envelope
  dominantFrequencies: FrequencyPoint[]; // time-sliced dominant frequencies
  explanations: {
    classificationRationale: string;
    tonalRatioExplanation: string;
    centroidExplanation: string;
    limitations: string;
  };
}
