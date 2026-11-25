import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { DEFAULT_RECONSTRUCTION_CONFIG } from '@/config/appConfig';
import { convertAudioToMath, reconstructFromMathModel } from '@/audio/math/mathPipeline';
import {
  generateMathC,
  generateMathCpp,
  generateMathJson,
  generateMathJsOrTs,
  generateMathPython,
} from '@/audio/export/mathCodeGenerators';
import { TWO_PI } from '@/audio/analysis/fft';
import { compareAudioSignals } from '@/audio/comparison/comparator';
import { createSeededRandom } from '@/audio/synthesis/noise';
import { MathSoundModel } from '@/types/mathModel';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sin-sfx-export-test-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readInterleavedF32(filePath: string, channels: number, numSamples: number): Float32Array[] {
  const buf = fs.readFileSync(filePath);
  expect(buf.byteLength).toBe(channels * numSamples * 4);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = Array.from({ length: channels }, () => new Float32Array(numSamples));
  let pos = 0;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < channels; c++) {
      out[c]![i] = view.getFloat32(pos, true);
      pos += 4;
    }
  }
  return out;
}

function assertNoForbiddenAudioBlobs(code: string): void {
  expect(code).not.toMatch(/data:audio\//i);
  expect(code).not.toMatch(/fetch\s*\(/);
  expect(code).not.toMatch(/XMLHttpRequest/);
  expect(code).not.toMatch(/RIFF.*WAVE.*data/);
  // Must not import local repo paths
  expect(code).not.toMatch(/@\/types\//);
}

function validateAllExportRuntimes(
  tag: string,
  model: MathSoundModel,
  expectedChannels: Float32Array[],
  minSnrDb = 70
): void {
  const caseDir = path.join(tmpDir, tag);
  fs.mkdirSync(caseDir, { recursive: true });

  // 1. JSON round-trip
  const jsonStr = generateMathJson(model, false);
  assertNoForbiddenAudioBlobs(jsonStr);
  const parsedModel = JSON.parse(jsonStr) as MathSoundModel;
  const jsonRecon = reconstructFromMathModel(parsedModel);
  const jsonCmp = compareAudioSignals(expectedChannels, jsonRecon, model.sampleRate);
  expect(jsonCmp.metrics.snrDb).toBeGreaterThan(minSnrDb);

  // 2. Standalone JavaScript executed in isolated Node.js process
  const jsCode = generateMathJsOrTs(model, false);
  assertNoForbiddenAudioBlobs(jsCode);
  const jsPath = path.join(caseDir, 'sound.mjs');
  const jsRawOut = path.join(caseDir, 'js.f32');
  const jsRunner = path.join(caseDir, 'run.mjs');
  fs.writeFileSync(jsPath, jsCode, 'utf8');
  fs.writeFileSync(
    jsRunner,
    `import fs from 'fs';
import * as mod from './sound.mjs';
const chs = mod.generateSamples();
const total = mod.NUM_SAMPLES * mod.CHANNELS;
const buf = Buffer.alloc(total * 4);
let off = 0;
for (let i = 0; i < mod.NUM_SAMPLES; i++) {
  for (let c = 0; c < mod.CHANNELS; c++) {
    buf.writeFloatLE(chs[c][i], off);
    off += 4;
  }
}
fs.writeFileSync(${JSON.stringify(jsRawOut)}, buf);
`,
    'utf8'
  );
  execFileSync('node', [jsRunner], { stdio: 'pipe' });
  const jsSamples = readInterleavedF32(jsRawOut, model.channels, model.length);
  const jsCmp = compareAudioSignals(expectedChannels, jsSamples, model.sampleRate);
  expect(jsCmp.metrics.snrDb, `[${tag}] JS mismatch RMSE=${jsCmp.metrics.rmse}`).toBeGreaterThan(minSnrDb);

  // 3. Standalone TypeScript strict type-check (isolated from repo!)
  const tsCode = generateMathJsOrTs(model, true);
  assertNoForbiddenAudioBlobs(tsCode);
  const tsPath = path.join(caseDir, 'sound.ts');
  fs.writeFileSync(tsPath, tsCode, 'utf8');
  try {
    execFileSync(
      path.resolve(process.cwd(), 'node_modules/.bin/tsc'),
      [
        '--noEmit',
        '--strict',
        '--noUncheckedIndexedAccess',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--lib',
        'ES2022,DOM',
        tsPath,
      ],
      { encoding: 'utf8', stdio: 'pipe' }
    );
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    throw new Error(`[${tag}] tsc failed:\n${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }

  // 4. Standalone C compiled with gcc and executed
  const cCode = generateMathC(model);
  assertNoForbiddenAudioBlobs(cCode);
  const cPath = path.join(caseDir, 'sound.c');
  const cBin = path.join(caseDir, 'sound_c');
  const cRawOut = path.join(caseDir, 'c.f32');
  fs.writeFileSync(cPath, cCode, 'utf8');
  execFileSync('gcc', ['-O2', '-DSOUND_MAIN', cPath, '-lm', '-o', cBin], { stdio: 'pipe' });
  execFileSync(cBin, ['--raw', cRawOut], { stdio: 'pipe' });
  const cSamples = readInterleavedF32(cRawOut, model.channels, model.length);
  const cCmp = compareAudioSignals(expectedChannels, cSamples, model.sampleRate);
  expect(cCmp.metrics.snrDb, `[${tag}] C mismatch RMSE=${cCmp.metrics.rmse}`).toBeGreaterThan(minSnrDb);

  // 5. Standalone C++ compiled with g++ -std=c++17 and executed
  const cppCode = generateMathCpp(model);
  assertNoForbiddenAudioBlobs(cppCode);
  const cppPath = path.join(caseDir, 'sound.cpp');
  const cppBin = path.join(caseDir, 'sound_cpp');
  const cppRawOut = path.join(caseDir, 'cpp.f32');
  fs.writeFileSync(cppPath, cppCode, 'utf8');
  execFileSync('g++', ['-std=c++17', '-O2', '-DSOUND_MAIN', cppPath, '-o', cppBin], { stdio: 'pipe' });
  execFileSync(cppBin, ['--raw', cppRawOut], { stdio: 'pipe' });
  const cppSamples = readInterleavedF32(cppRawOut, model.channels, model.length);
  const cppCmp = compareAudioSignals(expectedChannels, cppSamples, model.sampleRate);
  expect(cppCmp.metrics.snrDb, `[${tag}] C++ mismatch RMSE=${cppCmp.metrics.rmse}`).toBeGreaterThan(minSnrDb);

  // 6. Standalone Python 3 (stdlib only) executed
  const pyCode = generateMathPython(model);
  assertNoForbiddenAudioBlobs(pyCode);
  const pyPath = path.join(caseDir, 'sound.py');
  const pyRawOut = path.join(caseDir, 'py.f32');
  fs.writeFileSync(pyPath, pyCode, 'utf8');
  execFileSync('python3', [pyPath, '--raw', pyRawOut], { stdio: 'pipe' });
  const pySamples = readInterleavedF32(pyRawOut, model.channels, model.length);
  const pyCmp = compareAudioSignals(expectedChannels, pySamples, model.sampleRate);
  expect(pyCmp.metrics.snrDb, `[${tag}] Python mismatch RMSE=${pyCmp.metrics.rmse}`).toBeGreaterThan(minSnrDb);
}

describe('Independent Cross-Runtime Export Validation (JS, TS, C, C++, Python, JSON)', () => {
  const SR = 22050;

  it('validates Exact Mode (STFT Sinusoids) across all 6 standalone formats on stereo chord', () => {
    const len = Math.round(0.12 * SR);
    const chL = new Float32Array(len);
    const chR = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      chL[i] = 0.5 * Math.sin(TWO_PI * 440 * t + 0.4) + 0.25 * Math.sin(TWO_PI * 880 * t - 0.9);
      chR[i] = 0.6 * Math.sin(TWO_PI * 660 * t + 1.1);
    }

    const res = convertAudioToMath([chL, chR], SR, {
      ...DEFAULT_RECONSTRUCTION_CONFIG,
      mode: 'exact',
      fftSize: 512,
      windowSize: 512,
      hopSize: 256,
    });
    expect(res.metrics.snrDb).toBeGreaterThan(120);
    validateAllExportRuntimes('exact-stereo-stft', res.model, res.reconstructedChannels, 110);
  }, 30000);

  it('validates Optimized Mode (Sinusoidal Tracks + Residual Noise) across all 6 standalone formats', () => {
    const len = Math.round(0.18 * SR);
    const rng = createSeededRandom(123);
    const sig = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      sig[i] =
        0.55 * Math.sin(TWO_PI * (440 + 400 * t) * t + 0.5) * Math.exp(-4 * t) +
        0.15 * (rng() * 2 - 1) * Math.exp(-8 * t);
    }

    const res = convertAudioToMath([sig], SR, {
      ...DEFAULT_RECONSTRUCTION_CONFIG,
      mode: 'optimized',
      optimizedMethod: 'sinusoidal-tracks',
      maxOscillators: 12,
      enableResidualNoise: true,
      fftSize: 1024,
      windowSize: 512,
      hopSize: 128,
    });
    expect(res.model.representation).toBe('sinusoidal-tracks');
    validateAllExportRuntimes('optimized-tracks-residual', res.model, res.reconstructedChannels, 90);
  }, 30000);

  it('validates Optimized Sparse STFT Mode (preservePhase=false) across all 6 standalone formats', () => {
    const len = Math.round(0.12 * SR);
    const rng = createSeededRandom(99);
    const sig = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      sig[i] = (rng() * 2 - 1) * 0.6 * Math.exp(-10 * (i / SR));
    }

    const res = convertAudioToMath([sig], SR, {
      ...DEFAULT_RECONSTRUCTION_CONFIG,
      mode: 'optimized',
      optimizedMethod: 'stft-sparse',
      maxOscillators: 32,
      preservePhase: false,
      fftSize: 512,
      windowSize: 512,
      hopSize: 256,
    });
    expect(res.model.representation).toBe('stft-sinusoids');
    validateAllExportRuntimes('optimized-sparse-stft-nophase', res.model, res.reconstructedChannels, 90);
  }, 30000);

  it('validates Procedural Mode (closed-form sound(t) + noise burst) across all 6 standalone formats', () => {
    const len = Math.round(0.2 * SR);
    const rng = createSeededRandom(55);
    const sig = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      sig[i] =
        (0.5 * Math.sin(TWO_PI * 440 * t + 0.2) + 0.3 * Math.sin(TWO_PI * 880 * t - 0.5)) *
          Math.exp(-12 * t) +
        0.2 * (rng() * 2 - 1) * Math.exp(-18 * t);
    }

    const res = convertAudioToMath([sig], SR, {
      ...DEFAULT_RECONSTRUCTION_CONFIG,
      mode: 'procedural',
      maxOscillators: 6,
      enableResidualNoise: true,
    });
    expect(res.model.representation).toBe('procedural-math');
    const jsCode = generateMathJsOrTs(res.model, false);
    expect(jsCode).toContain('export function sound(t');
    validateAllExportRuntimes('procedural-bell-noise', res.model, res.reconstructedChannels, 90);
  }, 30000);
});
