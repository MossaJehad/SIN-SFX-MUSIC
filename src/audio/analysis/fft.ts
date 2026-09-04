/**
 * Lightweight in-place Radix-2 Cooley-Tukey Fast Fourier Transform (FFT).
 * Optimized for audio feature extraction (centroids, dominant peaks, spectral flatness).
 */

export class LightweightFFT {
  private size: number;
  private cosTable: Float32Array;
  private sinTable: Float32Array;
  private bitRev: Uint32Array;
  private window: Float32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of 2, received ${size}`);
    }
    this.size = size;

    // Precalculate Hann window
    this.window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }

    // Precalculate bit-reversal table
    this.bitRev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        if ((i & (1 << j)) !== 0) {
          rev |= 1 << (bits - 1 - j);
        }
      }
      this.bitRev[i] = rev;
    }

    // Precalculate twiddle factors
    const half = size / 2;
    this.cosTable = new Float32Array(half);
    this.sinTable = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  /**
   * Applies window and calculates magnitude spectrum for real input data.
   * Returns Float32Array of size (size / 2) with frequency bin magnitudes.
   */
  public computeMagnitudeSpectrum(input: Float32Array, offset = 0): Float32Array {
    const n = this.size;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    // Apply bit reversal and windowing
    for (let i = 0; i < n; i++) {
      const sample = (offset + i < input.length ? input[offset + i]! : 0) * this.window[i]!;
      const revIdx = this.bitRev[i]!;
      real[revIdx] = sample;
      imag[revIdx] = 0;
    }

    // Butterfly passes
    for (let step = 1; step < n; step *= 2) {
      const doubleStep = step * 2;
      const stepInc = n / doubleStep;

      for (let group = 0; group < n; group += doubleStep) {
        for (let pair = 0; pair < step; pair++) {
          const twiddleIdx = pair * stepInc;
          const c = this.cosTable[twiddleIdx]!;
          const s = this.sinTable[twiddleIdx]!;

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

    // Compute half-spectrum magnitude
    const half = n / 2;
    const magnitude = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      const r = real[i]!;
      const im = imag[i]!;
      magnitude[i] = Math.sqrt(r * r + im * im) / (n / 2);
    }

    return magnitude;
  }
}
