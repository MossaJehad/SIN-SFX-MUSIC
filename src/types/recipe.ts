export type OscillatorType = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';

export type FrequencyCurve = 'constant' | 'linear' | 'exponential';

export interface EnvelopeADSR {
  attack: number; // in seconds (e.g. 0.001 - 2.0)
  decay: number; // in seconds (e.g. 0.001 - 2.0)
  sustain: number; // gain ratio (0.0 - 1.0)
  release: number; // in seconds (e.g. 0.001 - 2.0)
}

export interface FilterSettings {
  enabled: boolean;
  cutoff: number; // in Hz (20 - 20000)
  q: number; // resonance Q factor (0.1 - 25)
}

export interface DistortionSettings {
  enabled: boolean;
  amount: number; // 0.0 (clean) - 1.0 (heavy saturation)
}

export interface DelaySettings {
  enabled: boolean;
  time: number; // in seconds (0.01 - 0.5)
  feedback: number; // 0.0 - 0.95
  mix: number; // 0.0 - 1.0 wet
}

export interface FrequencyModulationSettings {
  enabled: boolean;
  modFrequency: number; // Hz (0.5 - 2000)
  modDepth: number; // Hz modulation depth (0 - 5000)
}

export interface SoundLayer {
  id: string;
  name: string;
  enabled: boolean;
  solo: boolean;
  oscillatorType: OscillatorType;
  startTime: number; // in seconds
  duration: number; // in seconds
  gain: number; // 0.0 - 1.0
  pan: number; // -1.0 (left) to +1.0 (right)
  startFrequency: number; // Hz (20 - 20000)
  endFrequency: number; // Hz (20 - 20000)
  frequencyCurve: FrequencyCurve;
  envelope: EnvelopeADSR;
  lowPassFilter: FilterSettings;
  highPassFilter: FilterSettings;
  distortion: DistortionSettings;
  delay: DelaySettings;
  frequencyModulation: FrequencyModulationSettings;
  seed: number; // Deterministic random seed for noise generation
}

export interface RecipeMetadata {
  originalFileName?: string;
  originalDuration?: number;
  originalSizeBytes?: number;
  approximationScore?: number;
  generationPreset?: 'tiny' | 'balanced' | 'accurate';
  classification?: 'tonal' | 'percussive' | 'noisy' | 'mixed';
  createdAt: string;
  generator: string;
}

export interface SoundRecipe {
  version: 1;
  name: string;
  category?: string;
  duration: number; // overall duration in seconds
  masterGain: number; // normalized master gain (0.0 - 1.0)
  layers: SoundLayer[];
  metadata?: RecipeMetadata;
}

export interface RecipeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
