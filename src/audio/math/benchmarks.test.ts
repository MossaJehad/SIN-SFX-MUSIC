import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_RECONSTRUCTION_CONFIG } from '@/config/appConfig';
import { convertAudioToMath } from './mathPipeline';
import { calculateMathSizeReport } from '@/audio/export/sizeCalculator';
import { TWO_PI } from '@/audio/analysis/fft';
import { createSeededRandom } from '@/audio/synthesis/noise';
import { ReconstructionConfig } from '@/types/mathModel';

function gen(dur: number, sr: number, fn: (t: number, n: number) => number): Float32Array {
  const len = Math.round(dur * sr);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = fn(i / sr, i);
  return out;
}

function decodeWav(p: string): { channels: Float32Array[]; sr: number; bytes: number } {
  const buf = fs.readFileSync(p);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ch = v.getUint16(22, true);
  const sr = v.getUint32(24, true);
  let off = 12;
  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(
      v.getUint8(off),
      v.getUint8(off + 1),
      v.getUint8(off + 2),
      v.getUint8(off + 3)
    );
    const sz = v.getUint32(off + 4, true);
    if (id === 'data') {
      const frames = Math.floor(sz / (ch * 2));
      const channels = Array.from({ length: ch }, () => new Float32Array(frames));
      let pos = off + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < ch; c++) {
          channels[c]![i] = v.getInt16(pos, true) / 32768;
          pos += 2;
        }
      }
      return { channels, sr, bytes: buf.byteLength };
    }
    off += 8 + sz;
  }
  throw new Error('No data chunk');
}

describe('Accuracy, Compression & Runtime Performance Benchmarks', () => {
  it('benchmarks all sound classes across Exact, Optimized, and Procedural modes', () => {
    const SR = 44100;
    const rng = createSeededRandom(42);
    const wav = decodeWav(path.resolve(process.cwd(), 'e2e/test-assets/laser-test.wav'));

    const cases: { name: string; channels: Float32Array[]; sr: number; origBytes: number }[] = [
      {
        name: '440Hz Sine (0.3s)',
        channels: [gen(0.3, SR, (t) => 0.7 * Math.sin(TWO_PI * 440 * t + 0.8))],
        sr: SR,
        origBytes: Math.round(0.3 * SR) * 2 + 44,
      },
      {
        name: '3-Sine Chord (0.3s)',
        channels: [
          gen(
            0.3,
            SR,
            (t) =>
              0.5 * Math.sin(TWO_PI * 440 * t + 0.3) +
              0.3 * Math.sin(TWO_PI * 880 * t - 1.2) +
              0.15 * Math.sin(TWO_PI * 1320 * t + 2.1)
          ),
        ],
        sr: SR,
        origBytes: Math.round(0.3 * SR) * 2 + 44,
      },
      {
        name: 'Decaying Bell (0.35s)',
        channels: [
          gen(
            0.35,
            SR,
            (t) =>
              (0.5 * Math.sin(TWO_PI * 440 * t) + 0.3 * Math.sin(TWO_PI * 880 * t)) *
              Math.exp(-15 * t)
          ),
        ],
        sr: SR,
        origBytes: Math.round(0.35 * SR) * 2 + 44,
      },
      {
        name: 'UI Click (0.05s)',
        channels: [
          gen(
            0.05,
            SR,
            (t) => 0.8 * Math.sin(TWO_PI * (2000 * Math.exp(-30 * t)) * t) * Math.exp(-90 * t)
          ),
        ],
        sr: SR,
        origBytes: Math.round(0.05 * SR) * 2 + 44,
      },
      {
        name: 'Laser Sweep (0.25s)',
        channels: [
          gen(0.25, SR, (t) => {
            const ph =
              ((TWO_PI * 1600 * 0.25) / Math.log(220 / 1600)) *
              (Math.pow(220 / 1600, t / 0.25) - 1);
            return 0.75 * Math.sin(ph) * Math.exp(-3 * t);
          }),
        ],
        sr: SR,
        origBytes: Math.round(0.25 * SR) * 2 + 44,
      },
      {
        name: 'FM Synth (0.3s)',
        channels: [
          gen(
            0.3,
            SR,
            (t) => 0.7 * Math.sin(TWO_PI * 550 * t + (90 / 12) * Math.sin(TWO_PI * 12 * t))
          ),
        ],
        sr: SR,
        origBytes: Math.round(0.3 * SR) * 2 + 44,
      },
      {
        name: 'Explosion (0.4s)',
        channels: [
          gen(
            0.4,
            SR,
            (t) =>
              0.5 * Math.sin(TWO_PI * 75 * t) * Math.exp(-8 * t) +
              0.45 * (rng() * 2 - 1) * Math.exp(-6 * t)
          ),
        ],
        sr: SR,
        origBytes: Math.round(0.4 * SR) * 2 + 44,
      },
      {
        name: 'White Noise (0.2s)',
        channels: [gen(0.2, SR, () => (rng() * 2 - 1) * 0.5)],
        sr: SR,
        origBytes: Math.round(0.2 * SR) * 2 + 44,
      },
      {
        name: 'Stereo 440/660 (0.2s)',
        channels: [
          gen(0.2, SR, (t) => 0.7 * Math.sin(TWO_PI * 440 * t)),
          gen(0.2, SR, (t) => 0.5 * Math.sin(TWO_PI * 660 * t + 1.0)),
        ],
        sr: SR,
        origBytes: Math.round(0.2 * SR) * 4 + 44,
      },
      {
        name: 'laser-test.wav (0.2s)',
        channels: wav.channels,
        sr: wav.sr,
        origBytes: wav.bytes,
      },
    ];

    const rows: string[] = [];
    for (const tc of cases) {
      for (const mode of ['exact', 'optimized', 'procedural'] as const) {
        const cfg: ReconstructionConfig =
          mode === 'exact'
            ? {
                ...DEFAULT_RECONSTRUCTION_CONFIG,
                mode: 'exact',
                fftSize: 1024,
                windowSize: 1024,
                hopSize: 512,
              }
            : mode === 'optimized'
              ? { ...DEFAULT_RECONSTRUCTION_CONFIG, mode: 'optimized', maxOscillators: 32 }
              : {
                  ...DEFAULT_RECONSTRUCTION_CONFIG,
                  mode: 'procedural',
                  maxOscillators: 6,
                  enableResidualNoise: true,
                };
        const res = convertAudioToMath(tc.channels, tc.sr, cfg, { name: tc.name });
        const sz = calculateMathSizeReport(res.model, tc.origBytes, 'js');
        if (mode === 'exact') {
          expect(res.metrics.snrDb).toBeGreaterThan(120);
        }
        expect(res.timings.totalMs).toBeLessThan(2000);
        const snrStr = Number.isFinite(res.metrics.snrDb)
          ? `${res.metrics.snrDb.toFixed(1)} dB`
          : 'Inf dB';
        rows.push(
          `| ${tc.name} | ${mode} (${res.model.representation}) | ${snrStr} | ${res.metrics.rmse.toExponential(2)} | ${res.metrics.logSpectralDistanceDb.toFixed(2)} dB | ${(tc.origBytes / 1024).toFixed(1)} KB | ${(sz.mathJsonMinifiedBytes / 1024).toFixed(1)} KB | ${(sz.generatedCodeBytes / 1024).toFixed(1)} KB | ${sz.codeCompressionRatio.toFixed(2)}x | ${res.timings.totalMs.toFixed(1)} ms (${res.timings.reconstructionMs.toFixed(1)} ms) |`
        );
      }
    }
    console.log('\nBENCHMARK_TABLE_START\n' + rows.join('\n') + '\nBENCHMARK_TABLE_END\n');
  }, 60000);
});
