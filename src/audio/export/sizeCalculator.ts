import { SoundRecipe } from '@/types/recipe';
import { generateMinifiedJson, generateReadableJson } from './codeGenerators';

export interface SoundSizeReport {
  originalSizeBytes: number;
  readableJsonBytes: number;
  minifiedJsonBytes: number;
  standaloneRuntimeBytes: number;
  totalFirstUseBytes: number;
  additionalSoundBytes: number;
  reductionPercentage: number;
  isLargerThanOriginal: boolean;
  layerCount: number;
  activeLayerCount: number;
  estimatedSynthesisCost: {
    oscillators: number;
    filters: number;
    delays: number;
    distortionNodes: number;
    totalActiveNodes: number;
    cpuLevel: 'Low' | 'Moderate' | 'High';
  };
}

/**
 * Accurately measures the UTF-8 byte size of a string.
 */
export function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Calculates comprehensive size comparison and synthesis cost metrics.
 */
export function calculateSizeReport(recipe: SoundRecipe, originalSizeBytes = 0): SoundSizeReport {
  const readableJson = generateReadableJson(recipe);
  const minifiedJson = generateMinifiedJson(recipe);

  const readableJsonBytes = getByteLength(readableJson);
  const minifiedJsonBytes = getByteLength(minifiedJson);

  // Standalone minified runtime engine is approx 1,680 bytes (uncompressed)
  const standaloneRuntimeBytes = 1680;

  const totalFirstUseBytes = standaloneRuntimeBytes + minifiedJsonBytes;
  const additionalSoundBytes = minifiedJsonBytes;

  let reductionPercentage = 0;
  let isLargerThanOriginal = false;

  if (originalSizeBytes > 0) {
    if (minifiedJsonBytes > originalSizeBytes) {
      isLargerThanOriginal = true;
      reductionPercentage = -Math.round(
        ((minifiedJsonBytes - originalSizeBytes) / originalSizeBytes) * 100
      );
    } else {
      reductionPercentage = Math.round(
        ((originalSizeBytes - minifiedJsonBytes) / originalSizeBytes) * 100
      );
    }
  }

  // Synthesis complexity analysis
  let oscCount = 0;
  let filterCount = 0;
  let delayCount = 0;
  let distCount = 0;
  let activeLayers = 0;

  const anySolo = recipe.layers.some((l) => l.solo);

  for (const layer of recipe.layers) {
    if (!layer.enabled) continue;
    if (anySolo && !layer.solo) continue;

    activeLayers++;
    oscCount++;
    if (layer.frequencyModulation.enabled && layer.frequencyModulation.modDepth > 0) {
      oscCount++; // FM adds an extra modulator oscillator
    }
    if (layer.lowPassFilter.enabled) filterCount++;
    if (layer.highPassFilter.enabled) filterCount++;
    if (layer.delay.enabled && layer.delay.mix > 0) delayCount++;
    if (layer.distortion.enabled && layer.distortion.amount > 0.01) distCount++;
  }

  const totalNodes = oscCount + filterCount + delayCount + distCount + activeLayers; // envelopes and gain
  let cpuLevel: 'Low' | 'Moderate' | 'High' = 'Low';
  if (totalNodes > 12) cpuLevel = 'High';
  else if (totalNodes > 6) cpuLevel = 'Moderate';

  return {
    originalSizeBytes,
    readableJsonBytes,
    minifiedJsonBytes,
    standaloneRuntimeBytes,
    totalFirstUseBytes,
    additionalSoundBytes,
    reductionPercentage,
    isLargerThanOriginal,
    layerCount: recipe.layers.length,
    activeLayerCount: activeLayers,
    estimatedSynthesisCost: {
      oscillators: oscCount,
      filters: filterCount,
      delays: delayCount,
      distortionNodes: distCount,
      totalActiveNodes: totalNodes,
      cpuLevel,
    },
  };
}

/**
 * Formats bytes into human-readable size string (e.g. 1.2 KB or 450 B).
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
