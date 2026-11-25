import { SoundRecipe } from '@/types/recipe';
import { buildRecipeGraph } from '../synthesis/graph';

/**
 * Renders a SoundRecipe into an AudioBuffer using OfflineAudioContext.
 * Allows specifying tailTime (default 0.0 for exact duration alignment, or > 0 for delay tails).
 */
export async function renderRecipeToBuffer(
  recipe: SoundRecipe,
  sampleRate = 44100,
  tailTime = 0
): Promise<AudioBuffer> {
  const hasDelay = recipe.layers.some((l) => l.enabled && l.delay.enabled && l.delay.mix > 0.01);
  const effectiveTail = tailTime > 0 ? tailTime : hasDelay ? 0.08 : 0;
  const totalDuration = Math.max(0.02, Math.min(15.0, recipe.duration + effectiveTail));
  const frameCount = Math.max(1, Math.round(totalDuration * sampleRate));

  const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
  buildRecipeGraph(offlineCtx, recipe, offlineCtx.destination, 0);

  return offlineCtx.startRendering();
}

/**
 * Calculates audio peak and RMS loudness across all channels of an AudioBuffer.
 */
export function calculateBufferMetrics(buffer: AudioBuffer): {
  peak: number;
  rms: number;
  duration: number;
} {
  let maxPeak = 0;
  let sumSquares = 0;
  let totalSamples = 0;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const sample = data[i] ?? 0;
      const abs = Math.abs(sample);
      if (abs > maxPeak) maxPeak = abs;
      sumSquares += sample * sample;
      totalSamples++;
    }
  }

  const rms = totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) : 0;

  return {
    peak: maxPeak,
    rms,
    duration: buffer.duration,
  };
}
