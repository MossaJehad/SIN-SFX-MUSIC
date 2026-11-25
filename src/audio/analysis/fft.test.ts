import { describe, it, expect } from 'vitest';
import {
  createWindow,
  getCachedFFT,
  HALF_PI,
  Radix2FFT,
  TWO_PI,
  wrapPhase,
} from './fft';
import { evaluateStftFrameDirectSinusoids } from '@/audio/math/stftEngine';
import { extractZeroPhaseSpectralPeaks } from './analyzer';
import { resampleChannel } from './resampler';

describe('Radix2FFT & Core DSP Mathematical Proofs', () => {
  it('round-trips complex FFT and IFFT to machine precision (< 1e-13)', () => {
    for (const size of [64, 256, 1024]) {
      const fft = new Radix2FFT(size);
      const origRe = new Float64Array(size);
      const origIm = new Float64Array(size);
      for (let i = 0; i < size; i++) {
        origRe[i] = Math.sin(0.13 * i) + 0.5 * Math.cos(0.47 * i);
        origIm[i] = Math.cos(0.29 * i) - 0.3 * Math.sin(0.71 * i);
      }
      const re = new Float64Array(origRe);
      const im = new Float64Array(origIm);

      fft.transform(re, im, false);
      fft.transform(re, im, true);

      let maxErr = 0;
      for (let i = 0; i < size; i++) {
        maxErr = Math.max(maxErr, Math.abs(re[i]! - origRe[i]!), Math.abs(im[i]! - origIm[i]!));
      }
      expect(maxErr).toBeLessThan(1e-13);
    }
  });

  it('matches IFFT reconstruction identically to direct explicit sin() summation (including DC & Nyquist)', () => {
    const N = 256;
    const fs = 16000;
    const fft = getCachedFFT(N);

    // Composite signal with DC offset + interior sines with arbitrary phases + exact Nyquist (-1)^n
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const t = n / fs;
      x[n] =
        0.25 + // DC
        0.6 * Math.sin(TWO_PI * ((5 * fs) / N) * t + 0.7) +
        0.35 * Math.sin(TWO_PI * ((37 * fs) / N) * t - 1.9) -
        0.15 * Math.pow(-1, n); // Nyquist with negative sign
    }

    const { dc, amplitudes, phases } = fft.forwardSinusoids(x);
    expect(dc).toBeCloseTo(0.25, 12);
    expect(amplitudes[5]).toBeCloseTo(0.6, 12);
    expect(wrapPhase(phases[5]! - 0.7)).toBeCloseTo(0, 12);
    expect(amplitudes[37]).toBeCloseTo(0.35, 12);
    expect(wrapPhase(phases[37]! - -1.9)).toBeCloseTo(0, 12);
    expect(amplitudes[N / 2]).toBeCloseTo(0.15, 12);
    expect(phases[N / 2]).toBeCloseTo(-HALF_PI, 12);

    const sparseBins: number[] = [];
    for (let k = 1; k <= N / 2; k++) {
      if (amplitudes[k]! > 1e-12) sparseBins.push(k, amplitudes[k]!, phases[k]!);
    }

    const viaIfft = fft.inverseFromSparseSinusoids(dc, sparseBins);
    const viaDirectSin = evaluateStftFrameDirectSinusoids(
      { startSample: 0, dc, bins: sparseBins },
      N,
      fs
    );

    let maxErrOrig = 0;
    let maxErrEquiv = 0;
    for (let n = 0; n < N; n++) {
      maxErrOrig = Math.max(maxErrOrig, Math.abs(viaIfft[n]! - x[n]!));
      maxErrEquiv = Math.max(maxErrEquiv, Math.abs(viaIfft[n]! - viaDirectSin[n]!));
    }

    expect(maxErrOrig).toBeLessThan(1e-12);
    expect(maxErrEquiv).toBeLessThan(1e-12);
  });

  it('satisfies exact Constant Overlap-Add (COLA) for sqrt-hann at 50% and 75% overlap', () => {
    const W = 512;
    const w = createWindow(W, 'sqrt-hann');

    for (const hop of [W / 2, W / 4]) {
      const expectedSum = W / (2 * hop);
      const len = W * 3;
      const acc = new Float64Array(len);
      for (let start = -(W - hop); start < len; start += hop) {
        for (let i = 0; i < W; i++) {
          const idx = start + i;
          if (idx >= 0 && idx < len) acc[idx] = acc[idx]! + w[i]! * w[i]!;
        }
      }
      for (let i = 0; i < len; i++) {
        expect(acc[i]).toBeCloseTo(expectedSum, 12);
      }
    }
  });

  it('extracts off-bin frequency, true amplitude, and phase accurately via zero-phase parabolic peak interpolation', () => {
    const fs = 44100;
    const len = 4096;
    const freq = 440.0; // Non-bin-centered for N=2048 (bin 20.433)
    const amp = 0.72;
    const phi0 = 1.15;
    const x = new Float32Array(len);
    for (let n = 0; n < len; n++) {
      x[n] = amp * Math.sin((TWO_PI * freq * n) / fs + phi0);
    }

    const center = 2048;
    const peaks = extractZeroPhaseSpectralPeaks(x, center, fs, 2048, 1024, {
      minFrequency: 20,
      maxFrequency: 10000,
      minAmplitude: 0.01,
      maxPeaks: 5,
    });

    expect(peaks.length).toBe(1);
    const p = peaks[0]!;
    expect(Math.abs(p.frequency - freq)).toBeLessThan(0.15); // < 0.15 Hz error!
    expect(Math.abs(p.amplitude - amp)).toBeLessThan(0.01); // < 1.5% amplitude error!
    const expectedCenterPhase = wrapPhase((TWO_PI * freq * center) / fs + phi0);
    expect(Math.abs(wrapPhase(p.phase - expectedCenterPhase))).toBeLessThan(0.05);
  });

  it('resamples a 440 Hz tone from 48 kHz to 22.05 kHz accurately without aliasing', () => {
    const srcRate = 48000;
    const dstRate = 22050;
    const dur = 0.25;
    const srcLen = Math.round(srcRate * dur);
    const src = new Float32Array(srcLen);
    for (let n = 0; n < srcLen; n++) {
      src[n] = 0.8 * Math.sin((TWO_PI * 440 * n) / srcRate + 0.4);
    }

    const dst = resampleChannel(src, srcRate, dstRate);
    expect(dst.length).toBe(Math.round(srcLen * (dstRate / srcRate)));

    // Compare interior samples (away from boundary filter transient) against ideal 22.05 kHz sine
    let sumSqErr = 0;
    let sumSqRef = 0;
    const margin = 64;
    for (let n = margin; n < dst.length - margin; n++) {
      const ref = 0.8 * Math.sin((TWO_PI * 440 * n) / dstRate + 0.4);
      const err = dst[n]! - ref;
      sumSqErr += err * err;
      sumSqRef += ref * ref;
    }
    const snrDb = 10 * Math.log10(sumSqRef / sumSqErr);
    expect(snrDb).toBeGreaterThan(60);
  });
});
