import { ResidualNoiseChannel } from '@/types/mathModel';
import { createWindow, getCachedFFT, TWO_PI } from '@/audio/analysis/fft';
import { createSeededRandom } from '@/audio/synthesis/noise';
import { computeStftFrameStarts, roundSig } from './stftEngine';

const DEFAULT_BAND_EDGES_HZ = [20, 140, 350, 800, 1800, 3800, 7500, 13000, 24000];

/**
 * Extracts a compact deterministic multi-band noise envelope from a residual signal
 * `residual = original - sinusoidalReconstruction`. Contains zero original PCM samples.
 */
export function extractResidualNoiseModel(
  originalChannels: Float32Array[],
  sinusoidalChannels: Float32Array[],
  sampleRate: number,
  hopSize = 256,
  compression = 0.3
): ResidualNoiseChannel[] | undefined {
  const numChannels = originalChannels.length;
  const length = originalChannels[0]?.length ?? 0;
  if (length === 0) return undefined;

  const nyquist = sampleRate / 2;
  const bandEdgesHz = DEFAULT_BAND_EDGES_HZ.filter((f) => f < nyquist);
  bandEdgesHz.push(nyquist);
  const numBands = bandEdgesHz.length - 1;
  if (numBands <= 0) return undefined;

  const fftSize = 512;
  const actualHop = Math.max(64, Math.min(256, hopSize));
  const fft = getCachedFFT(fftSize);
  const win = createWindow(fftSize, 'sqrt-hann');
  const { starts } = computeStftFrameStarts(length, fftSize, actualHop, 'sqrt-hann');
  const binRes = sampleRate / fftSize;
  const half = fftSize >> 1;

  // Check if residual has meaningful energy (> 1% of original energy)
  let totalOrigEnergy = 0;
  let totalResEnergy = 0;
  const residuals: Float32Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    const orig = originalChannels[c]!;
    const sinC = sinusoidalChannels[c] ?? new Float32Array(length);
    const res = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const o = orig[i]!;
      const r = o - (sinC[i] ?? 0);
      res[i] = r;
      totalOrigEnergy += o * o;
      totalResEnergy += r * r;
    }
    residuals.push(res);
  }

  if (totalOrigEnergy < 1e-12 || totalResEnergy / totalOrigEnergy < 0.01) {
    return undefined;
  }

  const sigDigits = Math.max(2, Math.round(4 - compression * 2));
  const noiseChannels: ResidualNoiseChannel[] = [];
  const realBuf = new Float64Array(fftSize);
  const imagBuf = new Float64Array(fftSize);

  // Map FFT bins to bands
  const binToBand = new Int32Array(half + 1).fill(-1);
  const bandBinCount = new Int32Array(numBands);
  for (let k = 1; k <= half; k++) {
    const f = k * binRes;
    for (let b = 0; b < numBands; b++) {
      if (f >= bandEdgesHz[b]! && f <= bandEdgesHz[b + 1]!) {
        binToBand[k] = b;
        bandBinCount[b] = bandBinCount[b]! + 1;
        break;
      }
    }
  }

  for (let c = 0; c < numChannels; c++) {
    const res = residuals[c]!;
    const bandAmps: number[][] = [];

    for (let m = 0; m < starts.length; m++) {
      const start = starts[m]!;
      realBuf.fill(0);
      imagBuf.fill(0);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < length) {
          realBuf[i] = res[idx]! * win[i]!;
        }
      }

      fft.transform(realBuf, imagBuf, false);

      const bandPower = new Float64Array(numBands);
      for (let k = 1; k <= half; k++) {
        const b = binToBand[k]!;
        if (b >= 0) {
          const mag = Math.hypot(realBuf[k]!, imagBuf[k]!);
          bandPower[b] = bandPower[b]! + mag * mag;
        }
      }

      const frameBands: number[] = new Array(numBands);
      // Compensate for incoherent (random-phase) WOLA variance reduction sqrt(COLA)
      const colaFactor = Math.sqrt(fftSize / (2 * actualHop));
      for (let b = 0; b < numBands; b++) {
        const count = bandBinCount[b]!;
        const rmsMag = count > 0 ? (Math.sqrt(bandPower[b]! / count) / fftSize) * colaFactor : 0;
        frameBands[b] = rmsMag > 1e-6 ? roundSig(rmsMag, sigDigits) : 0;
      }
      bandAmps.push(frameBands);
    }

    noiseChannels.push({
      seed: 1337 + c * 9973,
      bandEdgesHz,
      hopSize: actualHop,
      bandAmps,
    });
  }

  return noiseChannels;
}

/**
 * Synthesizes deterministic residual noise exclusively from band envelopes + PRNG seed,
 * and adds it onto the sinusoidal output channels.
 */
export function addResidualNoiseToChannels(
  channels: Float32Array[],
  residualNoise: ResidualNoiseChannel[] | undefined,
  sampleRate: number
): void {
  if (!residualNoise || residualNoise.length === 0) return;
  const length = channels[0]?.length ?? 0;
  if (length === 0) return;

  const fftSize = 512;
  const half = fftSize >> 1;
  const fft = getCachedFFT(fftSize);
  const win = createWindow(fftSize, 'sqrt-hann');
  const binRes = sampleRate / fftSize;

  const realBuf = new Float64Array(fftSize);
  const imagBuf = new Float64Array(fftSize);

  for (let c = 0; c < Math.min(channels.length, residualNoise.length); c++) {
    const out = channels[c]!;
    const model = residualNoise[c]!;
    const rng = createSeededRandom(model.seed);
    const { starts } = computeStftFrameStarts(length, fftSize, model.hopSize, 'sqrt-hann');
    const numBands = model.bandEdgesHz.length - 1;

    const binToBand = new Int32Array(half + 1).fill(-1);
    for (let k = 1; k <= half; k++) {
      const f = k * binRes;
      for (let b = 0; b < numBands; b++) {
        if (f >= model.bandEdgesHz[b]! && f <= model.bandEdgesHz[b + 1]!) {
          binToBand[k] = b;
          break;
        }
      }
    }

    const noiseAcc = new Float64Array(length);
    const normAcc = new Float64Array(length);

    for (let m = 0; m < Math.min(starts.length, model.bandAmps.length); m++) {
      const start = starts[m]!;
      const frameBands = model.bandAmps[m]!;

      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < length) {
          normAcc[idx] = normAcc[idx]! + win[i]! * win[i]!;
        }
      }

      let hasEnergy = false;
      for (let b = 0; b < frameBands.length; b++) {
        if (frameBands[b]! > 0) {
          hasEnergy = true;
          break;
        }
      }
      if (!hasEnergy) continue;

      realBuf.fill(0);
      imagBuf.fill(0);

      for (let k = 1; k < half; k++) {
        const b = binToBand[k]!;
        if (b < 0) continue;
        const mag = (frameBands[b] ?? 0) * fftSize;
        if (mag <= 0) continue;
        const phase = rng() * TWO_PI;
        const re = mag * Math.cos(phase);
        const im = mag * Math.sin(phase);
        realBuf[k] = re;
        imagBuf[k] = im;
        realBuf[fftSize - k] = re;
        imagBuf[fftSize - k] = -im;
      }

      fft.transform(realBuf, imagBuf, true);

      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < length) {
          noiseAcc[idx] = noiseAcc[idx]! + realBuf[i]! * win[i]!;
        }
      }
    }

    for (let i = 0; i < length; i++) {
      const n = normAcc[i]!;
      if (n > 1e-12) {
        out[i] = out[i]! + noiseAcc[i]! / n;
      }
    }
  }
}
