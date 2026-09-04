/**
 * Generates an s-curve transfer function for Web Audio WaveShaperNode.
 * @param amount 0.0 (linear/clean) to 1.0 (hard saturation)
 * @param samples Number of curve points (standard: 512 or 1024)
 */
export function makeDistortionCurve(amount: number, samples = 512): Float32Array {
  const curve = new Float32Array(samples);
  if (amount <= 0.001) {
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = x;
    }
    return curve;
  }

  // Soft-clipping formula: (1 + k) * x / (1 + k * |x|)
  // Maps amount [0..1] to k factor [0..50]
  const k = (amount * 50) / (1 - Math.min(amount, 0.999) * 0.5);
  const deg = Math.PI / 180;

  for (let i = 0; i < samples; ++i) {
    const x = (i * 2) / samples - 1;
    if (k === 0) {
      curve[i] = x;
    } else {
      // Blend hyperbolic tangent soft saturation
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      // Clamp to [-1, 1]
      curve[i] = Math.max(-1, Math.min(1, curve[i] ?? 0));
    }
  }

  return curve;
}
