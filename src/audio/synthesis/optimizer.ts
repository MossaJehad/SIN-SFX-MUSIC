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

/**
 * Clones a SoundRecipe deeply.
 */
export function cloneRecipe(recipe: SoundRecipe): SoundRecipe {
  return JSON.parse(JSON.stringify(recipe)) as SoundRecipe;
}

/**
 * Optimizes a SoundRecipe by iteratively testing controlled perturbations
 * against the original audio analysis features.
 */
export async function optimizeRecipe(
  initialRecipe: SoundRecipe,
  originalAnalysis: AudioAnalysisResult,
  options: OptimizationOptions = {}
): Promise<OptimizationResult> {
  const { maxIterations = 30, onProgress, isCancelled = () => false } = options;

  let bestRecipe = cloneRecipe(initialRecipe);

  // Evaluate initial recipe
  const initialBuffer = await renderRecipeToBuffer(bestRecipe, 22050); // 22kHz for ultra-fast convergence
  const initialProcAnalysis = analyzeAudioBuffer(initialBuffer);
  let bestMetrics = calculateApproximationScore(originalAnalysis, initialProcAnalysis);
  let bestScore = bestMetrics.approximationScore;
  const initialScore = bestScore;

  if (onProgress) {
    onProgress(0, bestScore, bestRecipe);
  }

  let iterationsCompleted = 0;
  let cancelled = false;

  for (let i = 0; i < maxIterations; i++) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }

    // Clone and perturb one parameter
    const candidate = cloneRecipe(bestRecipe);
    if (candidate.layers.length > 0) {
      const layerIdx = i % candidate.layers.length;
      const layer = candidate.layers[layerIdx]!;
      perturbLayer(layer, i, originalAnalysis);
    }

    try {
      const candidateBuffer = await renderRecipeToBuffer(candidate, 22050);
      const procAnalysis = analyzeAudioBuffer(candidateBuffer);
      const metrics = calculateApproximationScore(originalAnalysis, procAnalysis);

      if (metrics.approximationScore > bestScore) {
        bestScore = metrics.approximationScore;
        bestMetrics = metrics;
        bestRecipe = candidate;
      }
    } catch {
      // If rendering fails on a candidate, ignore perturbation
    }

    iterationsCompleted++;
    const progress = (i + 1) / maxIterations;

    if (onProgress) {
      onProgress(progress, bestScore, bestRecipe);
    }

    // Yield control to event loop so UI stays responsive
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Update recipe metadata with the approximation score
  bestRecipe.metadata = {
    ...bestRecipe.metadata,
    approximationScore: bestScore,
    createdAt: new Date().toISOString(),
    generator: 'Resonance SFX Heuristic + Optimizer',
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

/**
 * Perturbs a layer parameter slightly according to iteration step.
 */
function perturbLayer(layer: SoundLayer, step: number, target: AudioAnalysisResult): void {
  const mode = step % 6;
  switch (mode) {
    case 0: {
      // Nudge frequencies closer to target estimates
      const targetStart = target.startFrequencyEstimate;
      const targetEnd = target.endFrequencyEstimate;
      layer.startFrequency = Math.round(layer.startFrequency * 0.9 + targetStart * 0.1);
      layer.endFrequency = Math.round(layer.endFrequency * 0.9 + targetEnd * 0.1);
      break;
    }
    case 1: {
      // Nudge attack / decay
      const factor = step % 2 === 0 ? 1.15 : 0.85;
      layer.envelope.decay = Math.max(0.005, Math.min(2.0, layer.envelope.decay * factor));
      break;
    }
    case 2: {
      // Nudge filter cutoff towards target spectral centroid
      if (layer.lowPassFilter.enabled) {
        const centroid = target.averageSpectralCentroid;
        layer.lowPassFilter.cutoff = Math.round(layer.lowPassFilter.cutoff * 0.8 + centroid * 0.2);
        layer.lowPassFilter.cutoff = Math.max(100, Math.min(18000, layer.lowPassFilter.cutoff));
      }
      break;
    }
    case 3: {
      // Nudge layer gain
      const gainDelta = step % 2 === 0 ? 0.05 : -0.05;
      layer.gain = Math.max(0.1, Math.min(1.0, layer.gain + gainDelta));
      break;
    }
    case 4: {
      // Nudge resonance Q
      if (layer.lowPassFilter.enabled) {
        layer.lowPassFilter.q = Math.max(
          0.5,
          Math.min(6.0, layer.lowPassFilter.q + (step % 2 === 0 ? 0.3 : -0.3))
        );
      }
      break;
    }
    case 5: {
      // Nudge distortion
      if (layer.distortion.enabled) {
        layer.distortion.amount = Math.max(
          0,
          Math.min(0.8, layer.distortion.amount + (step % 2 === 0 ? 0.05 : -0.05))
        );
      }
      break;
    }
  }
}
