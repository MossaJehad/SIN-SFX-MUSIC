/**
 * High-quality deterministic windowed-sinc resampler with automatic anti-aliasing
 * cutoff when downsampling. Operates on raw Float32Array channels (Web Worker & Node safe).
 */

function sinc(x: number): number {
  if (Math.abs(x) < 1e-12) return 1.0;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function blackmanWindow(x: number, halfWidth: number): number {
  const u = x / halfWidth; // in [-1, 1]
  if (Math.abs(u) >= 1) return 0;
  return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
}

/**
 * Resamples a mono Float32Array from `sourceRate` to `targetRate`.
 * Uses a Blackman-windowed sinc kernel with lobe radius `lobes` (default 16).
 */
export function resampleChannel(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
  lobes = 16
): Float32Array {
  if (sourceRate === targetRate || input.length === 0) {
    return new Float32Array(input);
  }

  const ratio = targetRate / sourceRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const output = new Float32Array(outLength);

  // Anti-aliasing low-pass cutoff when downsampling (ratio < 1)
  const cutoff = ratio < 1 ? ratio * 0.96 : 1.0;
  const support = ratio < 1 ? lobes / cutoff : lobes;

  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const start = Math.max(0, Math.ceil(srcPos - support));
    const end = Math.min(input.length - 1, Math.floor(srcPos + support));

    let sum = 0;
    let weightSum = 0;

    for (let j = start; j <= end; j++) {
      const dx = srcPos - j;
      const w = cutoff * sinc(dx * cutoff) * blackmanWindow(dx, support);
      sum += input[j]! * w;
      weightSum += w;
    }

    output[i] = Math.abs(weightSum) > 1e-12 ? sum / weightSum : 0;
  }

  return output;
}

/**
 * Resamples multi-channel PCM arrays cleanly while preserving exact channel count.
 */
export function resampleChannels(
  channels: Float32Array[],
  sourceRate: number,
  targetRate: number
): Float32Array[] {
  if (sourceRate === targetRate) {
    return channels.map((ch) => new Float32Array(ch));
  }
  return channels.map((ch) => resampleChannel(ch, sourceRate, targetRate));
}
