import { SoundRecipe } from '@/types/recipe';
import { ExportLanguage, MathSoundModel } from '@/types/mathModel';
import {
  generateMinifiedJson,
  generateReadableJson,
  generateStandaloneJs,
} from './codeGenerators';
import { generateMathExport, generateMathJson } from './mathCodeGenerators';

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

export interface MathSizeReport {
  originalFileSizeBytes: number;
  uncompressedPcm16Bytes: number;
  mathJsonPrettyBytes: number;
  mathJsonMinifiedBytes: number;
  generatedCodeBytes: number;
  selectedLanguage: ExportLanguage;
  jsonCompressionRatio: number; // original / mathJson (> 1 means smaller, < 1 means larger)
  codeCompressionRatio: number; // original / generatedCode
  isJsonLargerThanOriginal: boolean;
  isCodeLargerThanOriginal: boolean;
  reductionPercentJson: number;
  reductionPercentCode: number;
  componentSummary: string;
}

/**
 * Accurately measures the UTF-8 byte size of a string.
 */
export function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Computes completely honest byte-size and compression ratio metrics for a MathSoundModel
 * from actual serialized UTF-8 outputs (never hardcoded estimates).
 */
export function calculateMathSizeReport(
  model: MathSoundModel,
  originalFileSizeBytes: number,
  selectedLanguage: ExportLanguage = 'js',
  cachedCode?: string
): MathSizeReport {
  const jsonMin = generateMathJson(model, false);
  const jsonPretty = generateMathJson(model, true);
  const code = cachedCode ?? generateMathExport(model, selectedLanguage);

  const mathJsonMinifiedBytes = getByteLength(jsonMin);
  const mathJsonPrettyBytes = getByteLength(jsonPretty);
  const generatedCodeBytes = getByteLength(code);
  const uncompressedPcm16Bytes = model.length * model.channels * 2 + 44;

  const refBytes = originalFileSizeBytes > 0 ? originalFileSizeBytes : uncompressedPcm16Bytes;
  const jsonCompressionRatio =
    mathJsonMinifiedBytes > 0 ? refBytes / mathJsonMinifiedBytes : 1;
  const codeCompressionRatio =
    generatedCodeBytes > 0 ? refBytes / generatedCodeBytes : 1;

  const isJsonLargerThanOriginal =
    originalFileSizeBytes > 0 && mathJsonMinifiedBytes > originalFileSizeBytes;
  const isCodeLargerThanOriginal =
    originalFileSizeBytes > 0 && generatedCodeBytes > originalFileSizeBytes;

  const reductionPercentJson =
    originalFileSizeBytes > 0
      ? Math.round(((originalFileSizeBytes - mathJsonMinifiedBytes) / originalFileSizeBytes) * 100)
      : 0;
  const reductionPercentCode =
    originalFileSizeBytes > 0
      ? Math.round(((originalFileSizeBytes - generatedCodeBytes) / originalFileSizeBytes) * 100)
      : 0;

  let componentSummary = '';
  if (model.representation === 'stft-sinusoids') {
    componentSummary = `${model.stats.totalSinusoids.toLocaleString()} sinusoids across ${model.stats.totalFrames} frames (avg ${model.stats.avgSinusoidsPerFrame.toFixed(1)}/frame)`;
  } else if (model.representation === 'sinusoidal-tracks') {
    componentSummary = `${model.stats.totalTracks} tracks (max ${model.stats.maxSimultaneousTracks} simultaneous${model.residualNoise ? ' + residual noise' : ''})`;
  } else {
    componentSummary = `${model.stats.partialCount} analytical sine partial${model.stats.partialCount === 1 ? '' : 's'}${model.stats.noiseBurstCount > 0 ? ` + ${model.stats.noiseBurstCount} noise burst` : ''}`;
  }

  return {
    originalFileSizeBytes,
    uncompressedPcm16Bytes,
    mathJsonPrettyBytes,
    mathJsonMinifiedBytes,
    generatedCodeBytes,
    selectedLanguage,
    jsonCompressionRatio,
    codeCompressionRatio,
    isJsonLargerThanOriginal,
    isCodeLargerThanOriginal,
    reductionPercentJson,
    reductionPercentCode,
    componentSummary,
  };
}

/**
 * Calculates size comparison and synthesis cost metrics for a manual SoundRecipe.
 * Measures actual generated JS bytes instead of a hardcoded constant!
 */
export function calculateSizeReport(recipe: SoundRecipe, originalSizeBytes = 0): SoundSizeReport {
  const readableJson = generateReadableJson(recipe);
  const minifiedJson = generateMinifiedJson(recipe);
  const standaloneJs = generateStandaloneJs(recipe);

  const readableJsonBytes = getByteLength(readableJson);
  const minifiedJsonBytes = getByteLength(minifiedJson);
  const totalJsBytes = getByteLength(standaloneJs);
  const standaloneRuntimeBytes = Math.max(0, totalJsBytes - minifiedJsonBytes);

  const totalFirstUseBytes = totalJsBytes;
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
      oscCount++;
    }
    if (layer.lowPassFilter.enabled) filterCount++;
    if (layer.highPassFilter.enabled) filterCount++;
    if (layer.delay.enabled && layer.delay.mix > 0) delayCount++;
    if (layer.distortion.enabled && layer.distortion.amount > 0.01) distCount++;
  }

  const totalNodes = oscCount + filterCount + delayCount + distCount + activeLayers;
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

/**
 * Formats compression ratio honestly (e.g. "6.4x smaller" or "2.3x larger").
 */
export function formatCompressionRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'N/A';
  if (ratio >= 1.02) return `${ratio.toFixed(1)}× smaller`;
  if (ratio <= 0.98) return `${(1 / ratio).toFixed(1)}× larger`;
  return '1.0× (same)';
}
