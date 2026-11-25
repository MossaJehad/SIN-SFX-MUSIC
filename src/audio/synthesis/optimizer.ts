import { SoundRecipe, SoundLayer } from '@/types/recipe';
import { AudioAnalysisResult } from '@/types/analysis';
import { renderRecipeToBuffer } from '../rendering/renderer';
import { analyzeAudioBuffer } from '../analysis/analyzer';
import { calculateApproximationScore, ComparisonMetrics } from '../comparison/comparator';

export interface OptimizationOptions {
  maxIterations?: number;
  onProgress?: (progress: number, score: number, currentRecipe: SoundRecipe) => void;
  isCancelled?: () => boolean;
}

export interface OptimizationResult {
  optimizedRecipe: SoundRecipe;
  initialScore: number;
  finalScore: number;
  metrics: ComparisonMetrics;
  iterationsCompleted: number;
  cancelled: boolean;
}

export function cloneRecipe(recipe: SoundRecipe): SoundRecipe {
  return JSON.parse(JSON.stringify(recipe)) as SoundRecipe;
}

/**
 * Optimizes a manual SoundRecipe via bi-directional coordinate perturbation.
 * Fixes prior bug where odd perturbation modes could only ever step in one direction.
 */
export async function optimizeRecipe(
  initialRecipe: SoundRecipe,
  originalAnalysis: AudioAnalysisResult,
  options: OptimizationOptions = {}
): Promise<OptimizationResult> {
  const { maxIterations = 30, onProgress, isCancelled = () => false } = options;

  let bestRecipe = cloneRecipe(initialRecipe);

  const initialBuffer = await renderRecipeToBuffer(bestRecipe, 22050, 0);
  const initialProcAnalysis = analyzeAudioBuffer(initialBuffer);
  let bestMetrics = calculateApproximationScore(originalAnalysis, initialProcAnalysis);
  let bestScore = bestMetrics.approximationScore;
  const initialScore = bestScore;

  onProgress?.(0, bestScore, bestRecipe);

  let iterationsCompleted = 0;
  let cancelled = false;

  for (let i = 0; i < maxIterations; i++) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }

    const candidate = cloneRecipe(bestRecipe);
    if (candidate.layers.length > 0) {
      const layerIdx = i % candidate.layers.length;
      const layer = candidate.layers[layerIdx]!;
      perturbLayer(layer, i, originalAnalysis);
    }

    try {
      const candidateBuffer = await renderRecipeToBuffer(candidate, 22050, 0);
      const procAnalysis = analyzeAudioBuffer(candidateBuffer);
      const metrics = calculateApproximationScore(originalAnalysis, procAnalysis);

      if (metrics.approximationScore > bestScore) {
        bestScore = metrics.approximationScore;
        bestMetrics = metrics;
        bestRecipe = candidate;
      }
    } catch {
      // Ignore invalid perturbation
    }

    iterationsCompleted++;
    onProgress?.((i + 1) / maxIterations, bestScore, bestRecipe);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  bestRecipe.metadata = {
    ...bestRecipe.metadata,
    approximationScore: bestScore,
    createdAt: new Date().toISOString(),
    generator: 'Resonance SFX Coordinate Optimizer',
  };

  return {
    optimizedRecipe: bestRecipe,
    initialScore,
    finalScore: bestScore,
    metrics: bestMetrics,
    iterationsCompleted,
    cancelled,
  };
}

function perturbLayer(layer: SoundLayer, step: number, target: AudioAnalysisResult): void {
  const mode = step % 6;
  // Cycle sign across full passes of all 6 modes so every mode tests BOTH + and - directions!
  const passParity = Math.floor(step / 6) % 2 === 0 ? 1 : -1;

  switch (mode) {
    case 0: {
      const targetStart = Math.max(20, target.startFrequencyEstimate);
      const targetEnd = Math.max(20, target.endFrequencyEstimate);
      layer.startFrequency = Math.round(layer.startFrequency * 0.85 + targetStart * 0.15);
      layer.endFrequency = Math.round(layer.endFrequency * 0.85 + targetEnd * 0.15);
      break;
    }
    case 1: {
      const factor = passParity > 0 ? 1.15 : 0.85;
      layer.envelope.decay = Math.max(0.005, Math.min(2.0, layer.envelope.decay * factor));
      break;
    }
    case 2: {
      if (layer.lowPassFilter.enabled) {
        const centroid = Math.max(100, target.averageSpectralCentroid);
        layer.lowPassFilter.cutoff = Math.round(layer.lowPassFilter.cutoff * 0.8 + centroid * 0.2);
        layer.lowPassFilter.cutoff = Math.max(100, Math.min(18000, layer.lowPassFilter.cutoff));
      }
      break;
    }
    case 3: {
      layer.gain = Math.max(0.1, Math.min(1.0, layer.gain + passParity * 0.06));
      break;
    }
    case 4: {
      if (layer.lowPassFilter.enabled) {
        layer.lowPassFilter.q = Math.max(0.5, Math.min(6.0, layer.lowPassFilter.q + passParity * 0.35));
      }
      break;
    }
    case 5: {
      if (layer.distortion.enabled) {
        layer.distortion.amount = Math.max(
          0,
          Math.min(0.8, layer.distortion.amount + passParity * 0.05)
        );
      }
      break;
    }
  }
}
