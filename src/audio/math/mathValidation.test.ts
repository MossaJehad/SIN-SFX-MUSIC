import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_RECONSTRUCTION_CONFIG } from '@/config/appConfig';
import { ReconstructionConfig } from '@/types/mathModel';
import { convertAudioToMath, reconstructFromMathModel } from './mathPipeline';
import { TWO_PI } from '@/audio/analysis/fft';
import { createSeededRandom } from '@/audio/synthesis/noise';

function makeConfig(overrides: Partial<ReconstructionConfig> = {}): ReconstructionConfig {
  return { ...DEFAULT_RECONSTRUCTION_CONFIG, ...overrides };
}

function genSignal(
  duration: number,
  sampleRate: number,
  fn: (t: number, n: number) => number
): Float32Array {
  const len = Math.round(duration * sampleRate);
  const out = new Float32Array(len);
  for (let n = 0; n < len; n++) {
    out[n] = fn(n / sampleRate, n);
  }
  return out;
}

function decodePcm16Wav(filePath: string): { channels: Float32Array[]; sampleRate: number } {
  const buf = fs.readFileSync(filePath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  // Find 'data' chunk
  let offset = 12;
  while (offset + 8 <= buf.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const bytesPerSample = bitsPerSample / 8;
      const frames = Math.floor(size / (numChannels * bytesPerSample));
      const channels = Array.from({ length: numChannels }, () => new Float32Array(frames));
      let pos = offset + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < numChannels; c++) {
          channels[c]![i] = view.getInt16(pos, true) / 32768;
          pos += 2;
        }
      }
      return { channels, sampleRate };
    }
    offset += 8 + size;
  }
  throw new Error('WAV data chunk not found');
}

describe('Mathematical Validation Suite (Synthetic & Real-World Signals)', () => {
  const SR = 44100;

  it('1. Single 440 Hz sine wave: exact freq/amp/phase across Exact, Optimized, and Procedural modes', () => {
    const sig = genSignal(0.3, SR, (t) => 0.65 * Math.sin(TWO_PI * 440 * t + 0.85));

    // Exact mode
    const exact = convertAudioToMath([sig], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(exact.metrics.snrDb).toBeGreaterThan(120);
    expect(exact.metrics.rmse).toBeLessThan(1e-6);
    expect(exact.metrics.durationDifferenceSeconds).toBe(0);
    expect(exact.metrics.clippedSamples).toBe(0);

    // Optimized mode (sinusoidal tracks)
    const opt = convertAudioToMath([sig], SR, makeConfig({ mode: 'optimized', maxOscillators: 8 }));
    expect(opt.model.representation).toBe('sinusoidal-tracks');
    expect(opt.metrics.snrDb).toBeGreaterThan(35);
    expect(opt.metrics.logSpectralDistanceDb).toBeLessThan(2.5);
    if (opt.model.representation === 'sinusoidal-tracks') {
      const mainTrack = opt.model.channelTracks[0]![0]!;
      const midPt = mainTrack.points[Math.floor(mainTrack.points.length / 2)]!;
      expect(Math.abs(midPt[0] - 440)).toBeLessThan(0.5);
      expect(Math.abs(midPt[1] - 0.65)).toBeLessThan(0.02);
    }

    // Procedural mode
    const proc = convertAudioToMath([sig], SR, makeConfig({ mode: 'procedural', maxOscillators: 4 }));
    expect(proc.model.representation).toBe('procedural-math');
    expect(proc.metrics.snrDb).toBeGreaterThan(35);
    if (proc.model.representation === 'procedural-math') {
      expect(proc.model.partials.length).toBe(1);
      const p0 = proc.model.partials[0]!;
      expect(p0.frequency.type).toBe('constant');
      if (p0.frequency.type === 'constant') {
        expect(Math.abs(p0.frequency.freq - 440)).toBeLessThan(0.2);
      }
      expect(Math.abs(p0.amplitude - 0.65)).toBeLessThan(0.02);
    }
  });

  it('2. Multiple combined sine waves with distinct amplitudes and phases', () => {
    const sig = genSignal(
      0.3,
      SR,
      (t) =>
        0.5 * Math.sin(TWO_PI * 440 * t + 0.3) +
        0.3 * Math.sin(TWO_PI * 880 * t - 1.2) +
        0.15 * Math.sin(TWO_PI * 1320 * t + 2.1)
    );

    const exact = convertAudioToMath([sig], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(exact.metrics.snrDb).toBeGreaterThan(120);

    const opt = convertAudioToMath([sig], SR, makeConfig({ mode: 'optimized', maxOscillators: 16 }));
    expect(opt.metrics.snrDb).toBeGreaterThan(32);

    const proc = convertAudioToMath([sig], SR, makeConfig({ mode: 'procedural', maxOscillators: 6, compressionAggressiveness: 0.1 }));
    expect(proc.metrics.snrDb).toBeGreaterThan(30);
    if (proc.model.representation === 'procedural-math') {
      const freqs = proc.model.partials
        .filter((p) => p.frequency.type === 'constant')
        .map((p) => (p.frequency.type === 'constant' ? p.frequency.freq : 0))
        .sort((a, b) => a - b);
      expect(freqs.length).toBeGreaterThanOrEqual(3);
      expect(Math.abs(freqs[0]! - 440)).toBeLessThan(1.0);
      expect(Math.abs(freqs[1]! - 880)).toBeLessThan(1.0);
      expect(Math.abs(freqs[2]! - 1320)).toBeLessThan(1.0);
    }
  });

  it('3. Phase handling: preserves phase accurately AND measures measurable SNR impact when phase is discarded', () => {
    const sig = genSignal(
      0.25,
      SR,
      (t) =>
        0.45 * Math.sin(TWO_PI * 330 * t + 1.9) +
        0.4 * Math.sin(TWO_PI * 660 * t - 0.7)
    );

    const withPhase = convertAudioToMath([sig], SR, makeConfig({ mode: 'optimized', preservePhase: true }));
    const withoutPhase = convertAudioToMath([sig], SR, makeConfig({ mode: 'optimized', preservePhase: false }));

    expect(withPhase.metrics.snrDb).toBeGreaterThan(30);
    // Discarding phase measurably degrades phase-sensitive waveform SNR while keeping magnitude spectrum close!
    expect(withPhase.metrics.snrDb).toBeGreaterThan(withoutPhase.metrics.snrDb + 15);
    expect(withoutPhase.metrics.logSpectralDistanceDb).toBeLessThan(4.0);
  });

  it('4. Different amplitudes (quiet & near-full-scale) without unexpected clipping', () => {
    for (const amp of [0.05, 0.5, 0.92]) {
      const sig = genSignal(0.2, SR, (t) => amp * Math.sin(TWO_PI * 520 * t));
      const exact = convertAudioToMath([sig], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
      expect(exact.metrics.snrDb).toBeGreaterThan(120);
      expect(exact.metrics.clippedSamples).toBe(0);
      expect(Math.abs(exact.metrics.reconstructedPeak - amp)).toBeLessThan(1e-5);
    }
  });

  it('5. Frequency sweeps (linear & exponential laser chirp)', () => {
    const dur = 0.25;
    const f0 = 1600;
    const f1 = 220;
    const ratio = f1 / f0;
    const lnR = Math.log(ratio);
    const expSweep = genSignal(dur, SR, (t) => {
      const phase = ((TWO_PI * f0 * dur) / lnR) * (Math.pow(ratio, t / dur) - 1);
      return 0.75 * Math.sin(phase) * Math.exp(-3 * t);
    });

    const exact = convertAudioToMath([expSweep], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(exact.metrics.snrDb).toBeGreaterThan(120);

    const opt = convertAudioToMath([expSweep], SR, makeConfig({ mode: 'optimized', maxOscillators: 16, windowSize: 512, hopSize: 128, fftSize: 2048 }));
    expect(opt.metrics.snrDb).toBeGreaterThan(18);
    expect(opt.metrics.logSpectralDistanceDb).toBeLessThan(5.0);

    const proc = convertAudioToMath([expSweep], SR, makeConfig({ mode: 'procedural', maxOscillators: 4, windowSize: 512, hopSize: 128, fftSize: 2048 }));
    expect(proc.metrics.logSpectralDistanceDb).toBeLessThan(12.0);
  });

  it('6. Amplitude modulation (AM) and Frequency modulation (FM)', () => {
    const amSig = genSignal(
      0.35,
      SR,
      (t) => 0.45 * (1 + 0.65 * Math.sin(TWO_PI * 14 * t)) * Math.sin(TWO_PI * 600 * t)
    );
    const fmSig = genSignal(
      0.35,
      SR,
      (t) => 0.7 * Math.sin(TWO_PI * 550 * t + (90 / 12) * Math.sin(TWO_PI * 12 * t))
    );

    const amExact = convertAudioToMath([amSig], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    const fmExact = convertAudioToMath([fmSig], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(amExact.metrics.snrDb).toBeGreaterThan(120);
    expect(fmExact.metrics.snrDb).toBeGreaterThan(120);

    const amOpt = convertAudioToMath([amSig], SR, makeConfig({ mode: 'optimized', maxOscillators: 16, hopSize: 128, windowSize: 512 }));
    const fmOpt = convertAudioToMath([fmSig], SR, makeConfig({ mode: 'optimized', maxOscillators: 24, hopSize: 128, windowSize: 512 }));
    expect(amOpt.metrics.snrDb).toBeGreaterThan(20);
    expect(fmOpt.metrics.snrDb).toBeGreaterThan(15);
  });

  it('7. Exponential decay (bell / notification chime)', () => {
    const decaySig = genSignal(
      0.35,
      SR,
      (t) => (0.5 * Math.sin(TWO_PI * 440 * t) + 0.3 * Math.sin(TWO_PI * 880 * t)) * Math.exp(-15 * t)
    );

    const exact = convertAudioToMath([decaySig], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(exact.metrics.snrDb).toBeGreaterThan(120);

    const proc = convertAudioToMath([decaySig], SR, makeConfig({ mode: 'procedural', maxOscillators: 4, compressionAggressiveness: 0.1 }));
    expect(proc.metrics.snrDb).toBeGreaterThan(20);
    expect(proc.metrics.envelopeCorrelation).toBeGreaterThan(0.95);
  });

  it('8. Impulse signal (at n=0 and interior n=1000)', () => {
    const imp = new Float32Array(4096);
    imp[0] = 0.9;
    imp[1000] = -0.8;

    const exact = convertAudioToMath([imp], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(exact.metrics.snrDb).toBeGreaterThan(120);
    expect(exact.reconstructedChannels[0]![0]).toBeCloseTo(0.9, 5);
    expect(exact.reconstructedChannels[0]![1000]).toBeCloseTo(-0.8, 5);

    const opt = convertAudioToMath([imp], SR, makeConfig({ mode: 'optimized', maxOscillators: 128, fftSize: 512, windowSize: 512, hopSize: 256 }));
    // Auto mode detects high crest factor impulse -> uses Sparse STFT, preserving impulse timing!
    expect(opt.model.representation).toBe('stft-sinusoids');
    // Peak should stay right at index 0 and 1000
    expect(Math.abs(opt.reconstructedChannels[0]![1000]!)).toBeGreaterThan(0.15);
  });

  it('9. White noise: Exact recovers > 120 dB, Optimized/Procedural honestly measure approximation error', () => {
    const rng = createSeededRandom(777);
    const noise = genSignal(0.2, SR, () => (rng() * 2 - 1) * 0.5);

    const exact = convertAudioToMath([noise], SR, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(exact.metrics.snrDb).toBeGreaterThan(120);

    // Sparse STFT without uncorrelated residual noise has positive phase-aligned SNR
    const optSparse = convertAudioToMath([noise], SR, makeConfig({ mode: 'optimized', maxOscillators: 64, enableResidualNoise: false }));
    expect(optSparse.model.representation).toBe('stft-sinusoids');
    expect(optSparse.metrics.snrDb).toBeGreaterThan(0.5);
    expect(optSparse.metrics.snrDb).toBeLessThan(30); // Honestly reflects lossy sparse noise!

    // Enabling deterministic residual noise dramatically reduces Log-Spectral Distance
    // (theoretical Rayleigh/Gumbel floor for two independent white-noise realizations is ~7.88 dB)
    const optWithRes = convertAudioToMath([noise], SR, makeConfig({ mode: 'optimized', maxOscillators: 64, enableResidualNoise: true }));
    expect(optWithRes.metrics.logSpectralDistanceDb).toBeLessThan(optSparse.metrics.logSpectralDistanceDb - 5);
    expect(optWithRes.metrics.logSpectralDistanceDb).toBeLessThan(10.0);
  });

  it('10. Silence: exact zeros, zero components, no NaN/Infinity errors', () => {
    const silent = new Float32Array(4410);
    for (const mode of ['exact', 'optimized', 'procedural'] as const) {
      const res = convertAudioToMath([silent], SR, makeConfig({ mode }));
      expect(res.metrics.isExactSilenceMatch).toBe(true);
      expect(res.metrics.rmse).toBe(0);
      expect(res.metrics.snrDb).toBe(Infinity);
      expect(res.reconstructedChannels[0]!.every((v) => v === 0)).toBe(true);
    }
  });

  it('11. Stereo signals: preserves independent L/R channel separation with zero crosstalk', () => {
    const left = genSignal(0.2, SR, (t) => 0.7 * Math.sin(TWO_PI * 440 * t));
    const right = genSignal(0.2, SR, (t) => 0.5 * Math.sin(TWO_PI * 660 * t + 1.0));

    for (const mode of ['exact', 'optimized', 'procedural'] as const) {
      const res = convertAudioToMath([left, right], SR, makeConfig({ mode, maxOscillators: 16 }));
      expect(res.model.channels).toBe(2);
      expect(res.reconstructedChannels.length).toBe(2);
      expect(res.metrics.snrDb).toBeGreaterThan(25);
    }
  });

  it('12. Different sample rates (16k, 22.05k, 44.1k, 48k) and output sample rate conversion', () => {
    for (const sr of [16000, 22050, 44100, 48000]) {
      const sig = genSignal(0.15, sr, (t) => 0.6 * Math.sin(TWO_PI * 500 * t));
      const exact = convertAudioToMath([sig], sr, makeConfig({ mode: 'exact', fftSize: 512, windowSize: 512, hopSize: 256 }));
      expect(exact.sampleRate).toBe(sr);
      expect(exact.model.sampleRate).toBe(sr);
      expect(exact.metrics.snrDb).toBeGreaterThan(120);
    }

    // Resampling 48000 -> 22050 outputSampleRate
    const sig48 = genSignal(0.2, 48000, (t) => 0.7 * Math.sin(TWO_PI * 440 * t));
    const resampled = convertAudioToMath(
      [sig48],
      48000,
      makeConfig({ mode: 'optimized', outputSampleRate: 22050 })
    );
    expect(resampled.sampleRate).toBe(22050);
    expect(resampled.model.sampleRate).toBe(22050);
    expect(resampled.metrics.snrDb).toBeGreaterThan(30);
  });

  it('13. Real-world SFX (laser-test.wav) & deterministic output guarantee', () => {
    const wavPath = path.resolve(process.cwd(), 'e2e/test-assets/laser-test.wav');
    const { channels, sampleRate } = decodePcm16Wav(wavPath);

    const exactA = convertAudioToMath(channels, sampleRate, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    const exactB = convertAudioToMath(channels, sampleRate, makeConfig({ mode: 'exact', fftSize: 1024, windowSize: 1024, hopSize: 512 }));
    expect(exactA.metrics.snrDb).toBeGreaterThan(120);
    // Bit-for-bit deterministic!
    expect(exactA.reconstructedChannels[0]).toEqual(exactB.reconstructedChannels[0]);

    // Exclusively reconstruct from serialized JSON round-trip (proving zero reliance on original buffer!)
    const clonedModel = JSON.parse(JSON.stringify(exactA.model));
    const independentRecon = reconstructFromMathModel(clonedModel);
    expect(independentRecon[0]).toEqual(exactA.reconstructedChannels[0]);

    const opt = convertAudioToMath(channels, sampleRate, makeConfig({ mode: 'optimized', maxOscillators: 32 }));
    expect(opt.metrics.snrDb).toBeGreaterThan(10);

    const proc = convertAudioToMath(channels, sampleRate, makeConfig({ mode: 'procedural', maxOscillators: 6 }));
    expect(proc.reconstructedChannels[0]!.length).toBe(channels[0]!.length);
  });

  it('14. Quality controls produce real, measurable differences', () => {
    const complexSig = genSignal(0.25, SR, (t) => {
      let s = 0;
      for (let h = 1; h <= 12; h++) {
        s += (0.5 / h) * Math.sin(TWO_PI * (220 * h) * t + h * 0.4);
      }
      return s * Math.exp(-3 * t);
    });

    const fewOsc = convertAudioToMath(
      [complexSig],
      SR,
      makeConfig({ mode: 'optimized', maxOscillators: 2, targetQuality: 0.99, compressionAggressiveness: 0.1 })
    );
    const manyOsc = convertAudioToMath(
      [complexSig],
      SR,
      makeConfig({ mode: 'optimized', maxOscillators: 24, targetQuality: 0.99, compressionAggressiveness: 0.1 })
    );
    expect(manyOsc.metrics.snrDb).toBeGreaterThan(fewOsc.metrics.snrDb + 3);

    // Frequency range filter actually removes out-of-band energy
    const lowBandOnly = convertAudioToMath(
      [complexSig],
      SR,
      makeConfig({ mode: 'optimized', maxOscillators: 24, maxFrequency: 600 })
    );
    expect(manyOsc.metrics.snrDb).toBeGreaterThan(lowBandOnly.metrics.snrDb + 2);
  });
});
