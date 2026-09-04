import { describe, it, expect } from 'vitest';
import { makeDistortionCurve } from './distortion';

describe('Distortion Waveshaper Curve', () => {
  it('generates linear identity curve when amount is zero', () => {
    const samples = 256;
    const curve = makeDistortionCurve(0, samples);
    expect(curve.length).toBe(samples);
    // At midpoint, should be near 0
    expect(Math.abs(curve[128]!)).toBeLessThan(0.02);
    // Values should increase monotonically
    expect(curve[255]!).toBeGreaterThan(curve[0]!);
  });

  it('clamps all output values between -1.0 and 1.0 even at high amounts', () => {
    const curve = makeDistortionCurve(0.95, 512);
    for (let i = 0; i < curve.length; i++) {
      expect(curve[i]!).toBeGreaterThanOrEqual(-1.0);
      expect(curve[i]!).toBeLessThanOrEqual(1.0);
    }
  });

  it('compresses high amplitudes more aggressively than linear', () => {
    const linearCurve = makeDistortionCurve(0, 512);
    const distCurve = makeDistortionCurve(0.8, 512);

    // Near positive quarter
    const linSample = linearCurve[384]!;
    const distSample = distCurve[384]!;
    expect(distSample).toBeLessThan(linSample);
    expect(distSample).toBeGreaterThan(0.2);
  });
});
