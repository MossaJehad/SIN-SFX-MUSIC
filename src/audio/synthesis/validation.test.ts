import { describe, it, expect } from 'vitest';
import { validateRecipe } from './validation';
import { BUILT_IN_EXAMPLES } from '@/examples/builtInExamples';
import { SoundRecipe } from '@/types/recipe';

describe('Recipe Validation', () => {
  it('validates built-in examples successfully', () => {
    for (const [key, recipe] of Object.entries(BUILT_IN_EXAMPLES)) {
      const result = validateRecipe(recipe);
      expect(result.valid, `Example ${key} failed validation: ${result.errors.join(', ')}`).toBe(
        true
      );
      expect(result.errors.length).toBe(0);
    }
  });

  it('rejects null or non-object input', () => {
    expect(validateRecipe(null).valid).toBe(false);
    expect(validateRecipe('not a recipe').valid).toBe(false);
    expect(validateRecipe(undefined).valid).toBe(false);
  });

  it('rejects unsupported recipe version', () => {
    const invalid = { ...BUILT_IN_EXAMPLES['ui-click'], version: 99 };
    const result = validateRecipe(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('rejects non-positive duration', () => {
    const invalid = { ...BUILT_IN_EXAMPLES['ui-click'], duration: -1 };
    const result = validateRecipe(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duration'))).toBe(true);
  });

  it('flags invalid oscillator types in layers', () => {
    const recipe: SoundRecipe = {
      ...BUILT_IN_EXAMPLES['ui-click']!,
      layers: [
        {
          ...BUILT_IN_EXAMPLES['ui-click']!.layers[0]!,
          // @ts-expect-error test invalid oscillator
          oscillatorType: 'invalid_wave',
        },
      ],
    };
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('oscillatorType'))).toBe(true);
  });

  it('validates pan bounds [-1, 1]', () => {
    const recipe: SoundRecipe = {
      ...BUILT_IN_EXAMPLES['ui-click']!,
      layers: [
        {
          ...BUILT_IN_EXAMPLES['ui-click']!.layers[0]!,
          pan: 2.5,
        },
      ],
    };
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pan'))).toBe(true);
  });
});
