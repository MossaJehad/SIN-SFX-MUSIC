import { SoundRecipe, RecipeValidationResult, SoundLayer } from '@/types/recipe';

const VALID_OSCILLATORS = ['sine', 'triangle', 'square', 'sawtooth', 'noise'] as const;
const VALID_CURVES = ['constant', 'linear', 'exponential'] as const;

export function validateRecipe(recipe: unknown): RecipeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!recipe || typeof recipe !== 'object') {
    return { valid: false, errors: ['Recipe must be a valid JSON object.'], warnings: [] };
  }

  const r = recipe as Partial<SoundRecipe>;

  if (r.version !== 1) {
    errors.push(`Unsupported or missing recipe version: "${String(r.version)}". Expected 1.`);
  }

  if (typeof r.name !== 'string' || r.name.trim().length === 0) {
    errors.push('Recipe requires a non-empty string name.');
  }

  if (typeof r.duration !== 'number' || isNaN(r.duration) || r.duration <= 0) {
    errors.push('Recipe duration must be a positive number.');
  } else if (r.duration > 5.0) {
    warnings.push(
      `Sound duration (${r.duration.toFixed(2)}s) exceeds standard game SFX range (<= 3s).`
    );
  }

  if (
    typeof r.masterGain !== 'number' ||
    isNaN(r.masterGain) ||
    r.masterGain < 0 ||
    r.masterGain > 1
  ) {
    errors.push('Recipe masterGain must be a number between 0.0 and 1.0.');
  }

  if (!Array.isArray(r.layers)) {
    errors.push('Recipe layers must be an array.');
    return { valid: errors.length === 0, errors, warnings };
  }

  if (r.layers.length === 0) {
    warnings.push('Recipe contains zero layers and will be silent.');
  }

  r.layers.forEach((layer, index) => {
    validateLayer(layer, index, r.duration ?? 3, errors, warnings);
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateLayer(
  layer: unknown,
  index: number,
  maxDuration: number,
  errors: string[],
  warnings: string[]
): void {
  const p = `Layer #${index + 1}`;
  if (!layer || typeof layer !== 'object') {
    errors.push(`${p} is not a valid object.`);
    return;
  }

  const l = layer as Partial<SoundLayer>;

  if (typeof l.id !== 'string' || l.id.length === 0) {
    errors.push(`${p} must have an id.`);
  }

  if (!l.oscillatorType || !VALID_OSCILLATORS.includes(l.oscillatorType)) {
    errors.push(`${p} has invalid oscillatorType: "${String(l.oscillatorType)}".`);
  }

  if (typeof l.startTime !== 'number' || isNaN(l.startTime) || l.startTime < 0) {
    errors.push(`${p} startTime must be non-negative.`);
  } else if (l.startTime >= maxDuration) {
    warnings.push(`${p} starts at or after recipe duration (${l.startTime}s >= ${maxDuration}s).`);
  }

  if (typeof l.duration !== 'number' || isNaN(l.duration) || l.duration <= 0) {
    errors.push(`${p} duration must be positive.`);
  }

  if (typeof l.gain !== 'number' || isNaN(l.gain) || l.gain < 0 || l.gain > 1.5) {
    errors.push(`${p} gain must be between 0.0 and 1.5.`);
  }

  if (typeof l.pan !== 'number' || isNaN(l.pan) || l.pan < -1 || l.pan > 1) {
    errors.push(`${p} pan must be between -1.0 (left) and 1.0 (right).`);
  }

  if (l.oscillatorType !== 'noise') {
    if (
      typeof l.startFrequency !== 'number' ||
      isNaN(l.startFrequency) ||
      l.startFrequency < 10 ||
      l.startFrequency > 24000
    ) {
      errors.push(`${p} startFrequency must be between 10 Hz and 24,000 Hz.`);
    }
    if (
      typeof l.endFrequency !== 'number' ||
      isNaN(l.endFrequency) ||
      l.endFrequency < 10 ||
      l.endFrequency > 24000
    ) {
      errors.push(`${p} endFrequency must be between 10 Hz and 24,000 Hz.`);
    }
  }

  if (!l.frequencyCurve || !VALID_CURVES.includes(l.frequencyCurve)) {
    errors.push(`${p} has invalid frequencyCurve: "${String(l.frequencyCurve)}".`);
  }

  if (!l.envelope || typeof l.envelope !== 'object') {
    errors.push(`${p} envelope is missing.`);
  } else {
    const env = l.envelope;
    if (typeof env.attack !== 'number' || env.attack < 0) {
      errors.push(`${p} envelope attack must be non-negative.`);
    }
    if (typeof env.decay !== 'number' || env.decay < 0) {
      errors.push(`${p} envelope decay must be non-negative.`);
    }
    if (typeof env.sustain !== 'number' || env.sustain < 0 || env.sustain > 1) {
      errors.push(`${p} envelope sustain must be between 0.0 and 1.0.`);
    }
    if (typeof env.release !== 'number' || env.release < 0) {
      errors.push(`${p} envelope release must be non-negative.`);
    }
  }

  if (typeof l.seed !== 'number' || isNaN(l.seed)) {
    errors.push(`${p} seed must be a valid integer for deterministic synthesis.`);
  }
}
