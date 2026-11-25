import { WindowType } from '@/types/mathModel';

export const TWO_PI = 2 * Math.PI;
export const HALF_PI = Math.PI / 2;

/**
 * Wraps an angle in radians to the principal interval (-π, π].
 */
export function wrapPhase(angle: number): number {
  let a = (angle + Math.PI) % TWO_PI;
  if (a <= 0) a += TWO_PI;
  return a - Math.PI;
}

/**
 * Returns the smallest power of 2 >= n (minimum 2).
 */
export function nextPowerOf2(n: number): number {
  let p = 2;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Generates a periodic (DFT-even) window of length `size` suitable for COLA STFT analysis/synthesis.
 * - 'sqrt-hann' (sine window): w[n] = sin(π n / N), so w_a[n]*w_s[n] = Hann_periodic[n] (exact COLA for H = N/2, N/4, N/8)
 * - 'hann': periodic Hann w[n] = 0.5 * (1 - cos(2π n / N))
 * - 'hamming': periodic Hamming w[n] = 0.54 - 0.46 * cos(2π n / N)
 * - 'blackman-harris': 4-term periodic Blackman-Harris (-92 dB sidelobes)
 * - 'rectangular': all 1.0
 */
export function createWindow(size: number, type: WindowType = 'hann'): Float64Array {
  const w = new Float64Array(size);
  if (size <= 0) return w;
  if (size === 1) {
    w[0] = 1;
    return w;
  }

  switch (type) {
    case 'rectangular':
      w.fill(1);
      break;
    case 'sqrt-hann':
      for (let i = 0; i < size; i++) {
        w[i] = Math.sin((Math.PI * i) / size);
      }
      break;
    case 'hann':
      for (let i = 0; i < size; i++) {
        w[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / size));
      }
      break;
    case 'hamming':
      for (let i = 0; i < size; i++) {
        w[i] = 0.54 - 0.46 * Math.cos((TWO_PI * i) / size);
      }
      break;
    case 'blackman-harris': {
      const a0 = 0.35875;
      const a1 = 0.48829;
      const a2 = 0.14128;
      const a3 = 0.01168;
      for (let i = 0; i < size; i++) {
        const x = (TWO_PI * i) / size;
        w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
      }
      break;
    }
  }
  return w;
}

/**
 * Creates an exact even-symmetric window around index center (u = 0) of odd length (size - 1)
 * for zero-phase FFT analysis (zero phase distortion across main lobe).
 * Returns window of length `oddLen = size % 2 === 1 ? size : size - 1` and its coherent sum.
 */
export function createZeroPhaseWindow(
  windowSize: number,
  type: WindowType = 'hann'
): { window: Float64Array; halfLen: number; sum: number } {
  const oddLen = windowSize % 2 === 1 ? windowSize : Math.max(3, windowSize - 1);
  const halfLen = (oddLen - 1) >> 1;
  const w = new Float64Array(oddLen);
  let sum = 0;

  for (let i = 0; i < oddLen; i++) {
    const u = i - halfLen; // symmetric in [-halfLen .. +halfLen]
    const norm = u / (halfLen + 1); // in (-1, 1)
    let val = 1;
    switch (type) {
      case 'rectangular':
        val = 1;
        break;
      case 'sqrt-hann':
        val = Math.cos((Math.PI * norm) / 2);
        break;
      case 'hann':
        val = 0.5 * (1 + Math.cos(Math.PI * norm));
        break;
      case 'hamming':
        val = 0.54 + 0.46 * Math.cos(Math.PI * norm);
        break;
      case 'blackman-harris': {
        const theta = Math.PI * (norm + 1); // [0 .. 2π] symmetric at π
        val =
          0.35875 -
          0.48829 * Math.cos(theta) +
          0.14128 * Math.cos(2 * theta) -
          0.01168 * Math.cos(3 * theta);
        break;
      }
    }
    w[i] = val;
    sum += val;
  }

  return { window: w, halfLen, sum };
}

export function windowCoherentGain(window: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < window.length; i++) sum += window[i]!;
  return sum;
}

/**
 * High-precision Float64 Radix-2 Cooley-Tukey FFT & IFFT engine.
 * Supports full complex forward/inverse transforms, exact one-sided sinusoidal
 * decomposition (including DC and Nyquist), and Hermitian inverse synthesis.
 */
export class Radix2FFT {
  public readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly bitRev: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of 2 >= 2, received ${size}`);
    }
    this.size = size;

    this.bitRev = new Uint32Array(size);
    const bits = Math.round(Math.log2(size));
    for (let i = 0; i < size; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        if ((i & (1 << j)) !== 0) {
          rev |= 1 << (bits - 1 - j);
        }
      }
      this.bitRev[i] = rev;
    }

    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-TWO_PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  /**
   * In-place forward or inverse Complex FFT.
   * Forward: X[k] = sum_{n=0}^{N-1} x[n] * exp(-j 2π k n / N)
   * Inverse: x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * exp(+j 2π k n / N)
   */
  public transform(real: Float64Array, imag: Float64Array, inverse = false): void {
    const n = this.size;
    if (real.length !== n || imag.length !== n) {
      throw new Error(`Expected buffers of length ${n}, got ${real.length}/${imag.length}`);
    }

    // Bit-reversal permutation in-place
    for (let i = 0; i < n; i++) {
      const j = this.bitRev[i]!;
      if (j > i) {
        const tmpR = real[i]!;
        real[i] = real[j]!;
        real[j] = tmpR;

        const tmpI = imag[i]!;
        imag[i] = imag[j]!;
        imag[j] = tmpI;
      }
    }

    // Cooley-Tukey butterfly stages
    for (let step = 1; step < n; step <<= 1) {
      const doubleStep = step << 1;
      const stepInc = n / doubleStep;

      for (let group = 0; group < n; group += doubleStep) {
        for (let pair = 0; pair < step; pair++) {
          const twiddleIdx = pair * stepInc;
          const c = this.cosTable[twiddleIdx]!;
          const s = inverse ? -this.sinTable[twiddleIdx]! : this.sinTable[twiddleIdx]!;

          const j = group + pair;
          const k = j + step;

          const rK = real[k]!;
          const iK = imag[k]!;

          const tr = c * rK - s * iK;
          const ti = s * rK + c * iK;

          real[k] = real[j]! - tr;
          imag[k] = imag[j]! - ti;
          real[j] = real[j]! + tr;
          imag[j] = imag[j]! + ti;
        }
      }
    }

    if (inverse) {
      const invN = 1 / n;
      for (let i = 0; i < n; i++) {
        real[i] = real[i]! * invN;
        imag[i] = imag[i]! * invN;
      }
    }
  }

  /**
   * Computes full complex FFT of a real-valued array (length <= size, zero-padded to size).
   */
  public forwardReal(input: Float64Array | Float32Array): {
    real: Float64Array;
    imag: Float64Array;
  } {
    const n = this.size;
    const real = new Float64Array(n);
    const imag = new Float64Array(n);
    const copyLen = Math.min(n, input.length);
    for (let i = 0; i < copyLen; i++) {
      real[i] = input[i]!;
    }
    this.transform(real, imag, false);
    return { real, imag };
  }

  /**
   * Exact one-sided sinusoidal representation of a real frame of length N:
   *   x[n] = dc + sum_{k=1}^{N/2 - 1} amp[k] * sin(2π (k/N) n + phase[k]) + amp[N/2] * sin(π n + phase[N/2])
   * Includes DC (k = 0) and Nyquist (k = N/2). Length of arrays is N/2 + 1.
   */
  public forwardSinusoids(
    realInput: Float64Array | Float32Array,
    realBuf?: Float64Array,
    imagBuf?: Float64Array
  ): {
    dc: number;
    amplitudes: Float64Array;
    phases: Float64Array;
    real: Float64Array;
    imag: Float64Array;
  } {
    const n = this.size;
    const half = n >> 1;
    const real = realBuf ?? new Float64Array(n);
    const imag = imagBuf ?? new Float64Array(n);
    real.fill(0);
    imag.fill(0);

    const copyLen = Math.min(n, realInput.length);
    for (let i = 0; i < copyLen; i++) {
      real[i] = realInput[i]!;
    }

    this.transform(real, imag, false);

    const amplitudes = new Float64Array(half + 1);
    const phases = new Float64Array(half + 1);

    // DC component (k = 0): c0 = Re(X[0]) / N
    const dc = real[0]! / n;
    amplitudes[0] = Math.abs(dc);
    phases[0] = dc >= 0 ? HALF_PI : -HALF_PI;

    // Positive interior bins (1 .. N/2 - 1)
    const scale = 2 / n;
    for (let k = 1; k < half; k++) {
      const re = real[k]!;
      const im = imag[k]!;
      amplitudes[k] = scale * Math.hypot(re, im);
      phases[k] = wrapPhase(Math.atan2(im, re) + HALF_PI);
    }

    // Nyquist component (k = N/2): X[N/2] is purely real for real input
    const nyq = real[half]! / n;
    amplitudes[half] = Math.abs(nyq);
    phases[half] = nyq >= 0 ? HALF_PI : -HALF_PI;

    return { dc, amplitudes, phases, real, imag };
  }

  /**
   * Inverse-synthesizes a real time-domain frame of length N from sparse sinusoidal triplets
   * [bin, amp, phase, ...] and DC offset. Mathematically equivalent to evaluating:
   *   x[n] = dc + sum_i amp_i * sin(2π * (bin_i / N) * n + phase_i)
   * but runs in O(N log N) via Hermitian IFFT.
   */
  public inverseFromSparseSinusoids(
    dc: number,
    bins: ArrayLike<number>,
    outReal?: Float64Array,
    scratchImag?: Float64Array
  ): Float64Array {
    const n = this.size;
    const half = n >> 1;
    const real = outReal ?? new Float64Array(n);
    const imag = scratchImag ?? new Float64Array(n);
    real.fill(0);
    imag.fill(0);

    real[0] = n * dc;
    const halfN = n * 0.5;

    for (let i = 0; i + 2 < bins.length; i += 3) {
      const k = Math.round(bins[i]!);
      const amp = bins[i + 1]!;
      const phase = bins[i + 2]!;
      if (amp === 0) continue;

      if (k === 0) {
        real[0] = real[0]! + n * amp * Math.sin(phase);
      } else if (k === half) {
        real[half] = real[half]! + n * amp * Math.sin(phase);
      } else if (k > 0 && k < half) {
        const cosPhase = phase - HALF_PI;
        const re = halfN * amp * Math.cos(cosPhase);
        const im = halfN * amp * Math.sin(cosPhase);
        real[k] = real[k]! + re;
        imag[k] = imag[k]! + im;
        real[n - k] = real[n - k]! + re;
        imag[n - k] = imag[n - k]! - im;
      }
    }

    this.transform(real, imag, true);
    return real;
  }

  /**
   * Computes coherent-gain-normalized magnitude spectrum (length N/2 + 1, including DC & Nyquist)
   * with a given window. For a pure cosine/sine of amplitude A at a bin center, returns A!
   */
  public computeNormalizedMagnitudeSpectrum(
    input: Float32Array | Float64Array,
    offset = 0,
    window?: Float64Array
  ): Float64Array {
    const n = this.size;
    const half = n >> 1;
    const win = window ?? createWindow(n, 'hann');
    const winLen = Math.min(n, win.length);
    const cg = windowCoherentGain(win);
    const invCg = cg > 0 ? 1 / cg : 1 / n;

    const real = new Float64Array(n);
    const imag = new Float64Array(n);

    for (let i = 0; i < winLen; i++) {
      const idx = offset + i;
      const sample = idx >= 0 && idx < input.length ? input[idx]! : 0;
      real[i] = sample * win[i]!;
    }

    this.transform(real, imag, false);

    const magnitude = new Float64Array(half + 1);
    // DC: / sum(w)
    magnitude[0] = Math.abs(real[0]!) * invCg;
    // Interior bins: 2 / sum(w)
    const interiorScale = 2 * invCg;
    for (let k = 1; k < half; k++) {
      magnitude[k] = Math.hypot(real[k]!, imag[k]!) * interiorScale;
    }
    // Nyquist: / sum(w)
    magnitude[half] = Math.abs(real[half]!) * invCg;

    return magnitude;
  }
}

/**
 * Cache FFT instances by size to avoid reallocating twiddle tables across repeated calls.
 */
const fftCache = new Map<number, Radix2FFT>();

export function getCachedFFT(size: number): Radix2FFT {
  let fft = fftCache.get(size);
  if (!fft) {
    fft = new Radix2FFT(size);
    fftCache.set(size, fft);
  }
  return fft;
}

/**
 * Backward-compatible wrapper around Radix2FFT with corrected normalization and periodic Hann window.
 */
export class LightweightFFT {
  private readonly fft: Radix2FFT;
  private readonly window: Float64Array;

  constructor(size: number, windowType: WindowType = 'hann') {
    this.fft = getCachedFFT(size);
    this.window = createWindow(size, windowType);
  }

  /**
   * Computes coherent-gain-normalized magnitude spectrum of length (size / 2 + 1),
   * including both DC (bin 0) and Nyquist (bin size/2).
   */
  public computeMagnitudeSpectrum(input: Float32Array, offset = 0): Float32Array {
    const mag64 = this.fft.computeNormalizedMagnitudeSpectrum(input, offset, this.window);
    return Float32Array.from(mag64);
  }
}
