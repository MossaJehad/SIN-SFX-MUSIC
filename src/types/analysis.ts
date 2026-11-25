export type SoundClassification = 'tonal' | 'percussive' | 'noisy' | 'mixed' | 'silent';

export interface EnvelopePoint {
  time: number; // in seconds
  amplitude: number; // RMS amplitude [0..1]
}

export interface FrequencyPoint {
  time: number; // in seconds
  frequency: number; // dominant frequency in Hz (parabolically interpolated)
  magnitude: number; // amplitude estimate
  phase?: number; // instantaneous phase in radians
}

export interface SpectralPeakSummary {
  frequency: number;
  amplitude: number;
  phase: number;
}

export interface AudioAnalysisResult {
  duration: number; // in seconds
  sampleRate: number; // in Hz
  channelCount: number; // original channel count
  sampleLength: number; // number of samples per channel
  isSilent: boolean; // true if signal peak is below silence threshold
  dcOffset: number; // mean value of signal
  peakAmplitude: number; // absolute peak [0..1+]
  rmsLoudness: number; // overall RMS power [0..1+]
  crestFactor: number; // peak / rms (high for impulses/clicks)
  zeroCrossingRate: number; // normalized zero-crossing rate [0..1]
  averageSpectralCentroid: number; // perceived brightness center in Hz
  tonalVsNoisyScore: number; // 0.0 (pure noise) to 1.0 (pure tonal)
  attackDuration: number; // time from onset to envelope peak in seconds
  decayDuration: number; // time from envelope peak to -20dB in seconds
  startFrequencyEstimate: number; // starting dominant frequency in Hz
  endFrequencyEstimate: number; // ending dominant frequency in Hz
  topSpectralPeaks: SpectralPeakSummary[]; // global prominent sinusoidal peaks
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
