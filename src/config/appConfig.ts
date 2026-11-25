import { ReconstructionConfig, ReconstructionMode } from '@/types/mathModel';

export const DEFAULT_RECONSTRUCTION_CONFIG: ReconstructionConfig = {
  mode: 'optimized',
  optimizedMethod: 'auto',
  maxOscillators: 32,
  targetQuality: 0.95,
  minFrequency: 20,
  maxFrequency: 20000,
  minAmplitudeDb: -60,
  fftSize: 2048,
  windowSize: 1024,
  hopSize: 256,
  windowType: 'sqrt-hann',
  outputSampleRate: 'original',
  preservePhase: true,
  compressionAggressiveness: 0.3,
  enableResidualNoise: false,
};

export interface ConversionPreset {
  id: 'tiny' | 'balanced' | 'accurate' | 'exact';
  label: string;
  description: string;
  mode: ReconstructionMode;
  maxLayers: number;
  optimizationIterations: number;
  allowEffects: boolean;
  config: Partial<ReconstructionConfig>;
}

export const APP_CONFIG = {
  name: 'Resonance SFX',
  tagline: 'Audio-to-Math Sinusoidal Converter & DSP Analyzer',
  version: '2.0.0',
  description:
    'Convert uploaded audio files into standalone mathematical sinusoidal representations S(t) = Σ A[n]·sin(2π·f[n]·t + φ[n]) with Exact, Optimized, and Procedural reconstruction modes.',
  privacyNotice: 'Your audio is processed locally in this browser and is not uploaded.',
  limits: {
    maxDurationSeconds: 15.0,
    recommendedExactDurationSeconds: 3.0,
    maxFileSizeBytes: 25 * 1024 * 1024, // 25 MB
    supportedFormats: [
      'audio/wav',
      'audio/mpeg',
      'audio/ogg',
      'audio/webm',
      'audio/flac',
      'audio/mp4',
      'audio/x-wav',
      'audio/mp3',
    ],
  },
  presets: {
    tiny: {
      id: 'tiny',
      label: 'Tiny (Procedural)',
      description: 'Compact closed-form mathematical approximation (fewest oscillators, smallest code).',
      mode: 'procedural',
      maxLayers: 3,
      optimizationIterations: 20,
      allowEffects: false,
      config: {
        mode: 'procedural',
        maxOscillators: 4,
        targetQuality: 0.8,
        minAmplitudeDb: -42,
        fftSize: 2048,
        windowSize: 1024,
        hopSize: 256,
        preservePhase: true,
        compressionAggressiveness: 0.75,
        enableResidualNoise: true,
      },
    },
    balanced: {
      id: 'balanced',
      label: 'Balanced (Optimized)',
      description: 'Sinusoidal resynthesis balancing recognizable fidelity, timing, and size.',
      mode: 'optimized',
      maxLayers: 4,
      optimizationIterations: 45,
      allowEffects: true,
      config: {
        mode: 'optimized',
        optimizedMethod: 'auto',
        maxOscillators: 32,
        targetQuality: 0.95,
        minAmplitudeDb: -60,
        fftSize: 2048,
        windowSize: 1024,
        hopSize: 256,
        windowType: 'sqrt-hann',
        preservePhase: true,
        compressionAggressiveness: 0.3,
        enableResidualNoise: false,
      },
    },
    accurate: {
      id: 'accurate',
      label: 'Accurate (High-Res Optimized)',
      description: 'Higher partial count and lower threshold for faithful complex sound reconstruction.',
      mode: 'optimized',
      maxLayers: 6,
      optimizationIterations: 80,
      allowEffects: true,
      config: {
        mode: 'optimized',
        optimizedMethod: 'auto',
        maxOscillators: 96,
        targetQuality: 0.995,
        minAmplitudeDb: -78,
        fftSize: 2048,
        windowSize: 1024,
        hopSize: 256,
        windowType: 'sqrt-hann',
        preservePhase: true,
        compressionAggressiveness: 0.1,
        enableResidualNoise: true,
      },
    },
    exact: {
      id: 'exact',
      label: 'Exact (Fourier Baseline)',
      description: 'Retains all STFT Fourier coefficients for numerical-precision reconstruction (typically larger than original).',
      mode: 'exact',
      maxLayers: 6,
      optimizationIterations: 1,
      allowEffects: true,
      config: {
        mode: 'exact',
        maxOscillators: 512,
        targetQuality: 1.0,
        minFrequency: 0,
        maxFrequency: 24000,
        minAmplitudeDb: -120,
        fftSize: 1024,
        windowSize: 1024,
        hopSize: 512,
        windowType: 'sqrt-hann',
        preservePhase: true,
        compressionAggressiveness: 0.0,
        enableResidualNoise: false,
      },
    },
  } satisfies Record<string, ConversionPreset>,
} as const;

export type PresetKey = keyof typeof APP_CONFIG.presets;
