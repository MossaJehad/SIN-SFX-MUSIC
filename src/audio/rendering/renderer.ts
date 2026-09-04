import { SoundRecipe } from '@/types/recipe';
import { buildRecipeGraph } from '../synthesis/graph';

/**
 * Renders a SoundRecipe into an AudioBuffer using OfflineAudioContext.
 * Guarantees bit-for-bit identical results between preview and WAV export.
 */
export async function renderRecipeToBuffer(
  recipe: SoundRecipe,
  sampleRate = 44100
): Promise<AudioBuffer> {
  const tailTime = 0.15; // Allow envelope release and delay tails to settle smoothly
  const totalDuration = Math.max(0.1, Math.min(6.0, recipe.duration + tailTime));
  const frameCount = Math.ceil(totalDuration * sampleRate);

  // 2 channels for stereo support (panning)
  const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);

  buildRecipeGraph(offlineCtx, recipe, offlineCtx.destination, 0);

  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
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
