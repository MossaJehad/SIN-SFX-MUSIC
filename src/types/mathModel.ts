export type ReconstructionMode = 'exact' | 'optimized' | 'procedural';

export type WindowType = 'sqrt-hann' | 'hann' | 'hamming' | 'blackman-harris' | 'rectangular';

export type OptimizedMethod = 'auto' | 'sinusoidal-tracks' | 'stft-sparse';

export type OutputSampleRateOption = 'original' | 48000 | 44100 | 22050 | 16000;

export type ExportLanguage = 'js' | 'ts' | 'c' | 'cpp' | 'python' | 'json';

export interface ReconstructionConfig {
  mode: ReconstructionMode;
  optimizedMethod: OptimizedMethod;
  maxOscillators: number; // 1 .. 512 (per frame or simultaneous partials)
  targetQuality: number; // 0.10 .. 0.999 (energy/fidelity target)
  minFrequency: number; // Hz (0 .. Nyquist)
  maxFrequency: number; // Hz (minFrequency .. Nyquist)
  minAmplitudeDb: number; // dB relative to full scale (-100 .. -6)
  fftSize: number; // 256 | 512 | 1024 | 2048 | 4096
  windowSize: number; // <= fftSize (allows zero-padding)
  hopSize: number; // e.g., windowSize / 2, windowSize / 4, windowSize / 8
  windowType: WindowType;
  outputSampleRate: OutputSampleRateOption;
  preservePhase: boolean;
  compressionAggressiveness: number; // 0.0 .. 1.0
  enableResidualNoise: boolean; // optional transient/broadband residual modeling
}

export interface StftFrameData {
  /** Frame start sample index relative to signal start (may be negative due to left padding) */
  startSample: number;
  /** DC offset component c0 = Re(X[0]) / N */
  dc: number;
  /**
   * Sparse sinusoidal components stored as flat triplets: [bin0, amp0, phase0, bin1, amp1, phase1, ...]
   * Frequency of component i is bin_i * sampleRate / fftSize.
   * Formula per frame: c0 + sum(amp_i * sin(2*pi * f_i * tau + phase_i)), windowed and overlap-added.
   */
  bins: number[];
}

export interface ResidualNoiseChannel {
  seed: number;
  bandEdgesHz: number[]; // length B + 1
  hopSize: number;
  /** Frame-by-band RMS energies: frames[m][b] */
  bandAmps: number[][];
}

export interface StftSinusoidsModel {
  format: 'sin-sfx-math-v2';
  mode: 'exact' | 'optimized';
  representation: 'stft-sinusoids';
  name: string;
  sampleRate: number;
  originalSampleRate: number;
  duration: number;
  length: number;
  channels: number;
  fftSize: number;
  windowSize: number;
  hopSize: number;
  windowType: WindowType;
  padLeft: number;
  preservePhase: boolean;
  /** Per-channel STFT sinusoidal frames */
  channelFrames: StftFrameData[][];
  /** Optional deterministic residual noise model */
  residualNoise?: ResidualNoiseChannel[];
  /** Metadata about component counts */
  stats: {
    totalFrames: number;
    totalSinusoids: number;
    maxSinusoidsPerFrame: number;
    avgSinusoidsPerFrame: number;
    isSilent: boolean;
  };
}

export interface SinusoidalTrack {
  /** Frame index where this partial becomes active */
  startFrame: number;
  /**
   * Per-frame track states: [freqHz, amplitude, phaseRad] for each consecutive frame.
   * Reconstructed with McAulay-Quatieri cubic phase interpolation (if preservePhase)
   * or continuous quadratic phase accumulation (if !preservePhase).
   */
  points: [number, number, number][];
}

export interface SinusoidalTracksModel {
  format: 'sin-sfx-math-v2';
  mode: 'optimized';
  representation: 'sinusoidal-tracks';
  name: string;
  sampleRate: number;
  originalSampleRate: number;
  duration: number;
  length: number;
  channels: number;
  fftSize: number;
  windowSize: number;
  hopSize: number;
  numFrames: number;
  preservePhase: boolean;
  dcOffset: number[];
  /** Per-channel continuous sinusoidal tracks */
  channelTracks: SinusoidalTrack[][];
  /** Optional deterministic residual noise model */
  residualNoise?: ResidualNoiseChannel[];
  stats: {
    totalFrames: number;
    totalTracks: number;
    maxSimultaneousTracks: number;
    avgSimultaneousTracks: number;
    isSilent: boolean;
  };
}

export type ProceduralFrequencyLaw =
  | { type: 'constant'; freq: number }
  | { type: 'linear'; startFreq: number; endFreq: number }
  | { type: 'exponential'; startFreq: number; endFreq: number }
  | { type: 'fm'; carrierFreq: number; modFreq: number; modDepth: number; modPhase: number };

export type ProceduralEnvelopeLaw =
  | { type: 'constant' }
  | { type: 'exp-decay'; decayRate: number }
  | { type: 'attack-decay'; attackTime: number; decayRate: number }
  | { type: 'am'; amFreq: number; amDepth: number; amPhase: number; decayRate: number }
  | { type: 'piecewise'; points: [number, number][] }; // [relativeTimeSec, gain0to1]

export interface ProceduralPartial {
  id: string;
  channel: number; // 0, 1, or -1 for shared mono/pan
  startTime: number;
  duration: number;
  amplitude: number;
  phase: number;
  frequency: ProceduralFrequencyLaw;
  envelope: ProceduralEnvelopeLaw;
}

export interface ProceduralNoiseBurst {
  id: string;
  channel: number;
  startTime: number;
  duration: number;
  amplitude: number;
  seed: number;
  lowCutHz: number;
  highCutHz: number;
  attackTime: number;
  decayRate: number;
}

export interface ProceduralMathModel {
  format: 'sin-sfx-math-v2';
  mode: 'procedural';
  representation: 'procedural-math';
  name: string;
  sampleRate: number;
  originalSampleRate: number;
  duration: number;
  length: number;
  channels: number;
  preservePhase: boolean;
  dcOffset: number[];
  partials: ProceduralPartial[];
  noiseBursts: ProceduralNoiseBurst[];
  stats: {
    partialCount: number;
    noiseBurstCount: number;
    isSilent: boolean;
  };
}

export type MathSoundModel = StftSinusoidsModel | SinusoidalTracksModel | ProceduralMathModel;

export interface SpectrumData {
  frequencies: Float32Array;
  originalDb: Float32Array;
  reconstructedDb: Float32Array;
}

export interface SpectrogramData {
  numFrames: number;
  numBins: number;
  maxFreqHz: number;
  duration: number;
  /** Flattened [frame * numBins + bin] in dB [-100..0] */
  originalDb: Float32Array;
  reconstructedDb: Float32Array;
}

export interface ReconstructionMetrics {
  rmse: number;
  peakAbsoluteError: number;
  relativeL2Error: number;
  snrDb: number; // Infinity when exact, -Infinity when original is silent & error > 0
  logSpectralDistanceDb: number; // dB (0 = identical magnitude spectrum)
  envelopeCorrelation: number; // Pearson r in [-1, 1]
  durationDifferenceSeconds: number;
  originalPeak: number;
  reconstructedPeak: number;
  clippedSamples: number;
  originalRms: number;
  reconstructedRms: number;
  isExactSilenceMatch: boolean;
  spectrum: SpectrumData;
  spectrogram: SpectrogramData;
  // Backward-compatible summary percentages (clearly labeled in UI as derived indicators, never fabricated accuracy)
  envelopeSimilarity: number;
  spectralSimilarity: number;
  timbreSimilarity: number;
  approximationScore: number;
  label: string;
}

export interface ExecutionTimings {
  analysisMs: number;
  conversionMs: number;
  reconstructionMs: number;
  comparisonMs: number;
  totalMs: number;
}

export interface MathConversionResult {
  model: MathSoundModel;
  reconstructedChannels: Float32Array[];
  differenceChannels: Float32Array[];
  sampleRate: number;
  metrics: ReconstructionMetrics;
  timings: ExecutionTimings;
}
