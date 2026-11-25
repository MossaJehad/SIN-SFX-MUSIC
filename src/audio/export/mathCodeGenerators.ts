import {
  ExportLanguage,
  MathSoundModel,
  ProceduralEnvelopeLaw,
  ProceduralFrequencyLaw,
  ProceduralMathModel,
  ResidualNoiseChannel,
  SinusoidalTracksModel,
  StftSinusoidsModel,
  WindowType,
} from '@/types/mathModel';

function fmtNum(n: number, highPrecision = false): string {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-15) return '0';
  const rounded = highPrecision ? Number(n.toPrecision(9)) : Number(n.toPrecision(7));
  return String(rounded);
}

function windowTypeId(wt: WindowType): number {
  switch (wt) {
    case 'rectangular':
      return 0;
    case 'sqrt-hann':
      return 1;
    case 'hann':
      return 2;
    case 'hamming':
      return 3;
    case 'blackman-harris':
      return 4;
  }
}

function sanitizeComment(s: string): string {
  return s.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
}

/**
 * Generates clean, readable JSON (or minified JSON) of a MathSoundModel.
 */
export function generateMathJson(model: MathSoundModel, pretty = true): string {
  return pretty ? JSON.stringify(model, null, 2) : JSON.stringify(model);
}

// ============================================================================
// Compact expression builders for Procedural mode (readable sound(t) function!)
// ============================================================================

function jsFreqPhaseExpr(law: ProceduralFrequencyLaw, tauVar: string, dur: number): string {
  switch (law.type) {
    case 'constant':
      return `2 * Math.PI * ${fmtNum(law.freq)} * ${tauVar}`;
    case 'linear':
      return `2 * Math.PI * (${fmtNum(law.startFreq)} * ${tauVar} + ${fmtNum((0.5 * (law.endFreq - law.startFreq)) / Math.max(1e-6, dur))} * ${tauVar} * ${tauVar})`;
    case 'exponential': {
      const f0 = Math.max(1, law.startFreq);
      const f1 = Math.max(1, law.endFreq);
      const ratio = f1 / f0;
      if (Math.abs(ratio - 1) < 1e-4) return `2 * Math.PI * ${fmtNum(f0)} * ${tauVar}`;
      const coeff = (2 * Math.PI * f0 * dur) / Math.log(ratio);
      return `${fmtNum(coeff)} * (Math.pow(${fmtNum(ratio)}, ${tauVar} / ${fmtNum(dur)}) - 1)`;
    }
    case 'fm': {
      const fm = Math.max(0.1, law.modFreq);
      const beta = law.modDepth / fm;
      return `2 * Math.PI * ${fmtNum(law.carrierFreq)} * ${tauVar} + ${fmtNum(beta)} * (Math.sin(2 * Math.PI * ${fmtNum(fm)} * ${tauVar} + ${fmtNum(law.modPhase)}) - ${fmtNum(Math.sin(law.modPhase))})`;
    }
  }
}

function jsEnvExpr(law: ProceduralEnvelopeLaw, tauVar: string): string {
  switch (law.type) {
    case 'constant':
      return '1';
    case 'exp-decay':
      return `Math.exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'attack-decay':
      return `(1 - Math.exp(-${tauVar} / ${fmtNum(Math.max(1e-4, law.attackTime))})) * Math.exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'am':
      return `Math.max(0, 1 + ${fmtNum(law.amDepth)} * Math.sin(2 * Math.PI * ${fmtNum(law.amFreq)} * ${tauVar} + ${fmtNum(law.amPhase)})) * Math.exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'piecewise':
      return `evalPiecewise(${JSON.stringify(law.points)}, ${tauVar})`;
  }
}

function cFreqPhaseExpr(law: ProceduralFrequencyLaw, tauVar: string, dur: number): string {
  switch (law.type) {
    case 'constant':
      return `TWO_PI * ${fmtNum(law.freq)} * ${tauVar}`;
    case 'linear':
      return `TWO_PI * (${fmtNum(law.startFreq)} * ${tauVar} + ${fmtNum((0.5 * (law.endFreq - law.startFreq)) / Math.max(1e-6, dur))} * ${tauVar} * ${tauVar})`;
    case 'exponential': {
      const f0 = Math.max(1, law.startFreq);
      const f1 = Math.max(1, law.endFreq);
      const ratio = f1 / f0;
      if (Math.abs(ratio - 1) < 1e-4) return `TWO_PI * ${fmtNum(f0)} * ${tauVar}`;
      const coeff = (2 * Math.PI * f0 * dur) / Math.log(ratio);
      return `${fmtNum(coeff)} * (pow(${fmtNum(ratio)}, ${tauVar} / ${fmtNum(dur)}) - 1.0)`;
    }
    case 'fm': {
      const fm = Math.max(0.1, law.modFreq);
      const beta = law.modDepth / fm;
      return `TWO_PI * ${fmtNum(law.carrierFreq)} * ${tauVar} + ${fmtNum(beta)} * (sin(TWO_PI * ${fmtNum(fm)} * ${tauVar} + ${fmtNum(law.modPhase)}) - ${fmtNum(Math.sin(law.modPhase))})`;
    }
  }
}

function cEnvExpr(law: ProceduralEnvelopeLaw, tauVar: string, pwIdx?: number): string {
  switch (law.type) {
    case 'constant':
      return '1.0';
    case 'exp-decay':
      return `exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'attack-decay':
      return `(1.0 - exp(-${tauVar} / ${fmtNum(Math.max(1e-4, law.attackTime))})) * exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'am':
      return `fmax(0.0, 1.0 + ${fmtNum(law.amDepth)} * sin(TWO_PI * ${fmtNum(law.amFreq)} * ${tauVar} + ${fmtNum(law.amPhase)})) * exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'piecewise':
      return `eval_piecewise(PW_${pwIdx}, ${law.points.length}, ${tauVar})`;
  }
}

function pyFreqPhaseExpr(law: ProceduralFrequencyLaw, tauVar: string, dur: number): string {
  switch (law.type) {
    case 'constant':
      return `TWO_PI * ${fmtNum(law.freq)} * ${tauVar}`;
    case 'linear':
      return `TWO_PI * (${fmtNum(law.startFreq)} * ${tauVar} + ${fmtNum((0.5 * (law.endFreq - law.startFreq)) / Math.max(1e-6, dur))} * ${tauVar} * ${tauVar})`;
    case 'exponential': {
      const f0 = Math.max(1, law.startFreq);
      const f1 = Math.max(1, law.endFreq);
      const ratio = f1 / f0;
      if (Math.abs(ratio - 1) < 1e-4) return `TWO_PI * ${fmtNum(f0)} * ${tauVar}`;
      const coeff = (2 * Math.PI * f0 * dur) / Math.log(ratio);
      return `${fmtNum(coeff)} * ((${fmtNum(ratio)} ** (${tauVar} / ${fmtNum(dur)})) - 1.0)`;
    }
    case 'fm': {
      const fm = Math.max(0.1, law.modFreq);
      const beta = law.modDepth / fm;
      return `TWO_PI * ${fmtNum(law.carrierFreq)} * ${tauVar} + ${fmtNum(beta)} * (math.sin(TWO_PI * ${fmtNum(fm)} * ${tauVar} + ${fmtNum(law.modPhase)}) - ${fmtNum(Math.sin(law.modPhase))})`;
    }
  }
}

function pyEnvExpr(law: ProceduralEnvelopeLaw, tauVar: string): string {
  switch (law.type) {
    case 'constant':
      return '1.0';
    case 'exp-decay':
      return `math.exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'attack-decay':
      return `(1.0 - math.exp(-${tauVar} / ${fmtNum(Math.max(1e-4, law.attackTime))})) * math.exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'am':
      return `max(0.0, 1.0 + ${fmtNum(law.amDepth)} * math.sin(TWO_PI * ${fmtNum(law.amFreq)} * ${tauVar} + ${fmtNum(law.amPhase)})) * math.exp(${fmtNum(-law.decayRate)} * ${tauVar})`;
    case 'piecewise':
      return `eval_piecewise(${JSON.stringify(law.points)}, ${tauVar})`;
  }
}

// ============================================================================
// JavaScript & TypeScript Standalone Generators (Web Audio + Node.js compatible)
// ============================================================================

function jsWebAudioBoilerplate(isTs: boolean): string {
  if (isTs) {
    return `export interface PlaySoundOptions {
  volume?: number;
  destination?: AudioNode;
}

export function createAudioBuffer(audioContext: BaseAudioContext): AudioBuffer {
  const channels = generateSamples();
  const buffer = audioContext.createBuffer(CHANNELS, Math.max(1, NUM_SAMPLES), SAMPLE_RATE);
  for (let c = 0; c < CHANNELS; c++) {
    buffer.getChannelData(c).set(channels[c]!);
  }
  return buffer;
}

export function playSound(
  ctx?: BaseAudioContext,
  options: PlaySoundOptions = {}
): { duration: number; stop: () => void } {
  const AudioCtx =
    globalThis.AudioContext ||
    (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = ctx || new AudioCtx();
  if ('resume' in audioCtx && audioCtx.state === 'suspended') {
    void (audioCtx as AudioContext).resume();
  }
  const buffer = createAudioBuffer(audioCtx);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.value = options.volume ?? 1.0;
  source.connect(gain);
  gain.connect(options.destination || audioCtx.destination);
  source.start(0);
  return {
    duration: DURATION,
    stop: () => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    },
  };
}`;
  }

  return `export function createAudioBuffer(audioContext) {
  const channels = generateSamples();
  const buffer = audioContext.createBuffer(CHANNELS, Math.max(1, NUM_SAMPLES), SAMPLE_RATE);
  for (let c = 0; c < CHANNELS; c++) {
    buffer.getChannelData(c).set(channels[c]);
  }
  return buffer;
}

export function playSound(ctx, options = {}) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  const audioCtx = ctx || new AudioCtx();
  if (typeof audioCtx.resume === 'function' && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const buffer = createAudioBuffer(audioCtx);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.value = options.volume !== undefined ? options.volume : 1.0;
  source.connect(gain);
  gain.connect(options.destination || audioCtx.destination);
  source.start(0);
  return {
    duration: DURATION,
    stop: () => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    },
  };
}`;
}

function jsIfftHelper(isTs: boolean): string {
  const tF64 = isTs ? ': Float64Array' : '';
  const tNum = isTs ? ': number' : '';
  const tVoid = isTs ? ': void' : '';
  const tRetF64 = isTs ? ': Float64Array' : '';
  const nn = isTs ? '!' : '';

  return `function createWindow(size${tNum}, typeId${tNum})${tRetF64} {
  const w = new Float64Array(size);
  if (size <= 1) { if (size === 1) w[0] = 1; return w; }
  for (let i = 0; i < size; i++) {
    if (typeId === 0) w[i] = 1;
    else if (typeId === 1) w[i] = Math.sin((Math.PI * i) / size);
    else if (typeId === 2) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
    else if (typeId === 3) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / size);
    else {
      const x = (2 * Math.PI * i) / size;
      w[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
    }
  }
  return w;
}

function ifftInPlace(real${tF64}, imag${tF64})${tVoid} {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]${nn}; real[i] = real[j]${nn}; real[j] = tr;
      const ti = imag[i]${nn}; imag[i] = imag[j]${nn}; imag[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len;
    const wLenR = Math.cos(ang);
    const wLenI = Math.sin(ang);
    const halfLen = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wR = 1, wI = 0;
      for (let j = 0; j < halfLen; j++) {
        const uR = real[i + j]${nn}, uI = imag[i + j]${nn};
        const vR = real[i + j + halfLen]${nn} * wR - imag[i + j + halfLen]${nn} * wI;
        const vI = real[i + j + halfLen]${nn} * wI + imag[i + j + halfLen]${nn} * wR;
        real[i + j] = uR + vR; imag[i + j] = uI + vI;
        real[i + j + halfLen] = uR - vR; imag[i + j + halfLen] = uI - vI;
        const nextWR = wR * wLenR - wI * wLenI;
        wI = wR * wLenI + wI * wLenR;
        wR = nextWR;
      }
    }
  }
  const invN = 1 / n;
  for (let i = 0; i < n; i++) { real[i] = real[i]${nn} * invN; imag[i] = imag[i]${nn} * invN; }
}`;
}

function jsResidualNoiseHelper(
  residualNoise: ResidualNoiseChannel[] | undefined,
  isTs: boolean,
  needsIfft: boolean
): string {
  if (!residualNoise || residualNoise.length === 0) return '';
  const dataJson = JSON.stringify(residualNoise);
  const tNum = isTs ? ': number' : '';
  const tArr = isTs ? ': Float32Array[]' : '';
  const tVoid = isTs ? ': void' : '';
  const nn = isTs ? '!' : '';
  const rngFn = `function mulberry32(seed${tNum}) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}`;
  const ifftPart = needsIfft ? jsIfftHelper(isTs) + '\n\n' : '';

  return `${ifftPart}${rngFn}

const RESIDUAL_NOISE${isTs ? ': Array<{ seed: number; bandEdgesHz: number[]; hopSize: number; bandAmps: number[][] }>' : ''} = ${dataJson};

function addResidualNoise(outputs${tArr})${tVoid} {
  const fftSize = 512, half = 256, binRes = SAMPLE_RATE / fftSize;
  const win = createWindow(fftSize, 1);
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  for (let c = 0; c < Math.min(outputs.length, RESIDUAL_NOISE.length); c++) {
    const out = outputs[c]${nn};
    const m = RESIDUAL_NOISE[c]${nn};
    const rng = mulberry32(m.seed);
    const numBands = m.bandEdgesHz.length - 1;
    const binToBand = new Int32Array(half + 1).fill(-1);
    for (let k = 1; k <= half; k++) {
      const f = k * binRes;
      for (let b = 0; b < numBands; b++) {
        if (f >= m.bandEdgesHz[b]${nn} && f <= m.bandEdgesHz[b + 1]${nn}) { binToBand[k] = b; break; }
      }
    }
    const padLeft = fftSize - m.hopSize;
    const acc = new Float64Array(NUM_SAMPLES), norm = new Float64Array(NUM_SAMPLES);
    for (let fi = 0, start = -padLeft; start < NUM_SAMPLES && fi < m.bandAmps.length; start += m.hopSize, fi++) {
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < NUM_SAMPLES) norm[idx] = norm[idx]${nn} + win[i]${nn} * win[i]${nn};
      }
      const bands = m.bandAmps[fi]${nn};
      let any = false;
      for (let b = 0; b < bands.length; b++) if (bands[b]${nn} > 0) { any = true; break; }
      if (!any) continue;
      re.fill(0); im.fill(0);
      for (let k = 1; k < half; k++) {
        const b = binToBand[k]${nn};
        if (b < 0) continue;
        const mag = (bands[b] ?? 0) * fftSize;
        if (mag <= 0) continue;
        const ph = rng() * 2 * Math.PI;
        const r = mag * Math.cos(ph), ii = mag * Math.sin(ph);
        re[k] = r; im[k] = ii; re[fftSize - k] = r; im[fftSize - k] = -ii;
      }
      ifftInPlace(re, im);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < NUM_SAMPLES) acc[idx] = acc[idx]${nn} + re[i]${nn} * win[i]${nn};
      }
    }
    for (let i = 0; i < NUM_SAMPLES; i++) {
      if (norm[i]${nn} > 1e-12) out[i] = out[i]${nn} + acc[i]${nn} / norm[i]${nn};
    }
  }
}`;
}

export function generateMathJsOrTs(model: MathSoundModel, isTs: boolean): string {
  const header = `/**
 * Standalone Mathematical Audio Synthesis Module (${isTs ? 'TypeScript' : 'JavaScript'})
 * Source Name: ${sanitizeComment(model.name)}
 * Mode: ${model.mode} | Representation: ${model.representation}
 * Formula: S(t) = Σ A[n] * sin(2π * f[n] * t + φ[n])
 * Zero external dependencies, zero embedded PCM/WAV/Base64 assets.
 */

export const SAMPLE_RATE = ${model.sampleRate};
export const DURATION = ${fmtNum(model.duration, true)};
export const CHANNELS = ${model.channels};
export const NUM_SAMPLES = ${model.length};
export const MODE = '${model.mode}'${isTs ? ' as const' : ''};
export const REPRESENTATION = '${model.representation}'${isTs ? ' as const' : ''};
`;

  if (model.representation === 'procedural-math') {
    return header + buildJsProceduralBody(model, isTs) + '\n\n' + jsWebAudioBoilerplate(isTs) + '\n';
  }

  if (model.representation === 'sinusoidal-tracks') {
    return header + buildJsTracksBody(model, isTs) + '\n\n' + jsWebAudioBoilerplate(isTs) + '\n';
  }

  return header + buildJsStftBody(model, isTs) + '\n\n' + jsWebAudioBoilerplate(isTs) + '\n';
}

function buildJsProceduralBody(model: ProceduralMathModel, isTs: boolean): string {
  const needsPiecewise = model.partials.some((p) => p.envelope.type === 'piecewise');
  const needsNoise = model.noiseBursts.length > 0;
  const tNum = isTs ? ': number' : '';
  const tRet = isTs ? ': number' : '';
  const nn = isTs ? '!' : '';

  const helpers: string[] = [];
  if (needsPiecewise) {
    helpers.push(`function evalPiecewise(pts${isTs ? ': [number, number][]' : ''}, tau${tNum})${tRet} {
  if (pts.length === 0) return 1;
  if (tau <= pts[0]${nn}[0]) return pts[0]${nn}[1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, g0] = pts[i]${nn};
    const [t1, g1] = pts[i + 1]${nn};
    if (tau >= t0 && tau <= t1) {
      const span = t1 - t0;
      return span <= 1e-9 ? g1 : g0 + ((tau - t0) / span) * (g1 - g0);
    }
  }
  return pts[pts.length - 1]${nn}[1];
}`);
  }

  if (needsNoise) {
    helpers.push(`function mulberry32(seed${tNum}) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}`);
  }

  // Generate clean closed-form sound(t, channel = 0) function!
  const soundLines: string[] = [];
  soundLines.push(`export function sound(t${tNum}, channel${tNum} = 0)${tRet} {`);
  soundLines.push(`  if (t < 0 || t >= DURATION) return 0;`);

  const hasNonZeroDc = model.dcOffset.some((d) => Math.abs(d) > 1e-12);
  if (hasNonZeroDc) {
    soundLines.push(`  const dc = ${JSON.stringify(model.dcOffset)}[channel] ?? 0;`);
    soundLines.push(`  let y = dc;`);
  } else {
    soundLines.push(`  let y = 0;`);
  }

  for (const p of model.partials) {
    const chCond =
      model.channels > 1 && p.channel !== -1 ? `if (channel === ${p.channel}) ` : '';
    const needsWindowCheck = p.startTime > 0 || p.startTime + p.duration < model.duration - 1e-6;
    const tauExpr = p.startTime > 0 ? `(t - ${fmtNum(p.startTime)})` : 't';
    const phaseExpr = jsFreqPhaseExpr(p.frequency, 'tau', p.duration);
    const phaseShift = Math.abs(p.phase) > 1e-12 ? ` + ${fmtNum(p.phase)}` : '';
    const envExpr = jsEnvExpr(p.envelope, 'tau');
    const envMul = envExpr === '1' ? '' : ` * ${envExpr}`;
    const term = `${fmtNum(p.amplitude)} * Math.sin(${phaseExpr}${phaseShift})${envMul}`;

    if (needsWindowCheck) {
      soundLines.push(`  ${chCond}{`);
      soundLines.push(`    const tau = ${tauExpr};`);
      soundLines.push(`    if (tau >= 0 && tau <= ${fmtNum(p.duration)}) {`);
      soundLines.push(`      y += ${term};`);
      soundLines.push(`    }`);
      soundLines.push(`  }`);
    } else {
      soundLines.push(`  ${chCond}{ const tau = ${tauExpr}; y += ${term}; }`);
    }
  }
  soundLines.push(`  return y;`);
  soundLines.push(`}`);

  const noiseSection = needsNoise
    ? `
const NOISE_BURSTS = ${JSON.stringify(model.noiseBursts)};`
    : '';

  const genLines: string[] = [];
  genLines.push(`export function generateSamples()${isTs ? ': Float32Array[]' : ''} {`);
  genLines.push(`  const outputs${isTs ? ': Float32Array[]' : ''} = [];`);
  genLines.push(`  for (let c = 0; c < CHANNELS; c++) {`);
  genLines.push(`    const out = new Float32Array(NUM_SAMPLES);`);
  genLines.push(`    for (let i = 0; i < NUM_SAMPLES; i++) {`);
  genLines.push(`      out[i] = sound(i / SAMPLE_RATE, c);`);
  genLines.push(`    }`);
  if (needsNoise) {
    genLines.push(`    for (const nb of NOISE_BURSTS) {`);
    genLines.push(`      if (nb.channel !== -1 && nb.channel !== c) continue;`);
    genLines.push(`      const rng = mulberry32(nb.seed);`);
    genLines.push(`      const s0 = Math.max(0, Math.floor(nb.startTime * SAMPLE_RATE));`);
    genLines.push(`      const s1 = Math.min(NUM_SAMPLES, Math.ceil((nb.startTime + nb.duration) * SAMPLE_RATE));`);
    genLines.push(`      const dt = 1 / SAMPLE_RATE;`);
    genLines.push(`      const alphaLp = dt / (1 / (2 * Math.PI * Math.max(20, nb.highCutHz)) + dt);`);
    genLines.push(`      const rcHp = 1 / (2 * Math.PI * Math.max(10, nb.lowCutHz));`);
    genLines.push(`      const alphaHp = rcHp / (rcHp + dt);`);
    genLines.push(`      let lp = 0, hp = 0, prevLp = 0;`);
    genLines.push(`      for (let i = s0; i < s1; i++) {`);
    genLines.push(`        const tau = i / SAMPLE_RATE - nb.startTime;`);
    genLines.push(`        const w = rng() * 2 - 1;`);
    genLines.push(`        lp += alphaLp * (w - lp);`);
    genLines.push(`        hp = alphaHp * (hp + lp - prevLp);`);
    genLines.push(`        prevLp = lp;`);
    genLines.push(`        const env = (1 - Math.exp(-tau / Math.max(1e-4, nb.attackTime))) * Math.exp(-nb.decayRate * tau);`);
    genLines.push(`        out[i] = out[i]${nn} + nb.amplitude * env * hp;`);
    genLines.push(`      }`);
    genLines.push(`    }`);
  }
  genLines.push(`    outputs.push(out);`);
  genLines.push(`  }`);
  genLines.push(`  return outputs;`);
  genLines.push(`}`);

  return (
    (helpers.length > 0 ? '\n' + helpers.join('\n\n') + '\n' : '') +
    noiseSection +
    '\n\n' +
    soundLines.join('\n') +
    '\n\n' +
    genLines.join('\n')
  );
}

function buildJsTracksBody(model: SinusoidalTracksModel, isTs: boolean): string {
  const nn = isTs ? '!' : '';
  const compactChannels = model.channelTracks.map((tracks) =>
    tracks.map((tr) => {
      const flat: number[] = [];
      for (const pt of tr.points) {
        flat.push(pt[0], pt[1]);
        if (model.preservePhase) flat.push(pt[2]);
      }
      return [tr.startFrame, flat];
    })
  );

  const hasNoise = Boolean(model.residualNoise && model.residualNoise.length > 0);
  const residualCode = jsResidualNoiseHelper(model.residualNoise, isTs, true);
  const stride = model.preservePhase ? 3 : 2;
  const tNum = isTs ? ': number' : '';

  return `
const HOP_SIZE = ${model.hopSize};
const PRESERVE_PHASE = ${model.preservePhase};
const DC_OFFSET = ${JSON.stringify(model.dcOffset)};
// Per-channel tracks: [startFrame, [freq, amp${model.preservePhase ? ', phase' : ''}, ...]]
const CHANNEL_TRACKS${isTs ? ': Array<Array<[number, number[]]>>' : ''} = ${JSON.stringify(compactChannels)};
${residualCode ? '\n' + residualCode + '\n' : ''}
function wrapPhase(a${tNum})${tNum} {
  const twoPi = 2 * Math.PI;
  let r = (a + Math.PI) % twoPi;
  if (r <= 0) r += twoPi;
  return r - Math.PI;
}

export function generateSamples()${isTs ? ': Float32Array[]' : ''} {
  const twoPi = 2 * Math.PI;
  const stride = ${stride};
  const outputs${isTs ? ': Float32Array[]' : ''} = [];
  for (let c = 0; c < CHANNELS; c++) {
    const out64 = new Float64Array(NUM_SAMPLES);
    const dc = DC_OFFSET[c] ?? 0;
    if (dc !== 0) out64.fill(dc);
    const tracks = CHANNEL_TRACKS[c] ?? [];
    for (let ti = 0; ti < tracks.length; ti++) {
      const startFrame = tracks[ti]${nn}[0];
      const flat = tracks[ti]${nn}[1];
      const count = flat.length / stride;
      if (count === 0) continue;
      let runPhi = PRESERVE_PHASE ? flat[2]${nn} : 0;

      if (startFrame > 0) {
        const endS = Math.min(NUM_SAMPLES - 1, startFrame * HOP_SIZE);
        const startS = Math.max(0, (startFrame - 1) * HOP_SIZE);
        const span = endS - startS;
        if (span > 0) {
          const w1 = twoPi * flat[0]${nn}, a1 = flat[1]${nn}, p1 = PRESERVE_PHASE ? flat[2]${nn} : 0;
          const T = span / SAMPLE_RATE;
          const p0 = PRESERVE_PHASE ? p1 - w1 * T : 0;
          runPhi = PRESERVE_PHASE ? p1 : p0 + w1 * T;
          for (let n = 0; n < span; n++) {
            const idx = startS + n;
            if (idx >= NUM_SAMPLES) break;
            out64[idx] = out64[idx]${nn} + (a1 * n / span) * Math.sin(p0 + w1 * (n / SAMPLE_RATE));
          }
        }
      }

      for (let i = 0; i < count - 1; i++) {
        const s0 = Math.min(NUM_SAMPLES - 1, (startFrame + i) * HOP_SIZE);
        const s1 = Math.min(NUM_SAMPLES, (startFrame + i + 1) * HOP_SIZE);
        const span = s1 - s0;
        if (span <= 0) continue;
        const o0 = i * stride, o1 = (i + 1) * stride;
        const w0 = twoPi * flat[o0]${nn}, a0 = flat[o0 + 1]${nn}, p0 = PRESERVE_PHASE ? flat[o0 + 2]${nn} : 0;
        const w1 = twoPi * flat[o1]${nn}, a1 = flat[o1 + 1]${nn}, p1 = PRESERVE_PHASE ? flat[o1 + 2]${nn} : 0;
        const T = span / SAMPLE_RATE;
        if (PRESERVE_PHASE) {
          const mStar = Math.round(((p0 + w0 * T - p1) + 0.5 * (w1 - w0) * T) / twoPi);
          const dPhi = p1 - p0 - w0 * T + twoPi * mStar;
          const alpha = (3 * dPhi) / (T * T) - (w1 - w0) / T;
          const beta = (-2 * dPhi) / (T * T * T) + (w1 - w0) / (T * T);
          for (let n = 0; n < span; n++) {
            const idx = s0 + n;
            if (idx >= NUM_SAMPLES) break;
            const tau = n / SAMPLE_RATE;
            const amp = a0 + (a1 - a0) * (n / span);
            out64[idx] = out64[idx]${nn} + amp * Math.sin(p0 + tau * (w0 + tau * (alpha + tau * beta)));
          }
        } else {
          const slope = (w1 - w0) / (2 * T);
          const phiStart = runPhi;
          for (let n = 0; n < span; n++) {
            const idx = s0 + n;
            if (idx >= NUM_SAMPLES) break;
            const tau = n / SAMPLE_RATE;
            const amp = a0 + (a1 - a0) * (n / span);
            out64[idx] = out64[idx]${nn} + amp * Math.sin(phiStart + tau * (w0 + slope * tau));
          }
          runPhi = wrapPhase(phiStart + T * (w0 + slope * T));
        }
      }

      const lastF = startFrame + count - 1;
      const lastS = Math.min(NUM_SAMPLES - 1, lastF * HOP_SIZE);
      if (lastS < NUM_SAMPLES - 1) {
        const deathEnd = Math.min(NUM_SAMPLES, (lastF + 1) * HOP_SIZE);
        const span = deathEnd - lastS;
        if (span > 0) {
          const oL = (count - 1) * stride;
          const wL = twoPi * flat[oL]${nn}, aL = flat[oL + 1]${nn}, pL = PRESERVE_PHASE ? flat[oL + 2]${nn} : runPhi;
          for (let n = 0; n < span; n++) {
            const idx = lastS + n;
            if (idx >= NUM_SAMPLES) break;
            out64[idx] = out64[idx]${nn} + aL * (1 - n / span) * Math.sin(pL + wL * (n / SAMPLE_RATE));
          }
        }
      }
    }
    const out32 = new Float32Array(NUM_SAMPLES);
    for (let i = 0; i < NUM_SAMPLES; i++) out32[i] = out64[i]${nn};
    outputs.push(out32);
  }${hasNoise ? '\n  addResidualNoise(outputs);' : ''}
  return outputs;
}`;
}

function buildJsStftBody(model: StftSinusoidsModel, isTs: boolean): string {
  const nn = isTs ? '!' : '';
  const highPrec = model.mode === 'exact';
  const compactFrames = model.channelFrames.map((frames) =>
    frames.map((f) => {
      const bins: number[] = [];
      for (let i = 0; i + 2 < f.bins.length; i += 3) {
        bins.push(f.bins[i]!, Number(fmtNum(f.bins[i + 1]!, highPrec)));
        if (model.preservePhase) bins.push(Number(fmtNum(f.bins[i + 2]!, highPrec)));
      }
      return [f.startSample, Number(fmtNum(f.dc, highPrec)), bins];
    })
  );

  const hasNoise = Boolean(model.residualNoise && model.residualNoise.length > 0);
  const residualCode = jsResidualNoiseHelper(model.residualNoise, isTs, false);
  const stride = model.preservePhase ? 3 : 2;
  const winId = windowTypeId(model.windowType);

  return `
const FFT_SIZE = ${model.fftSize};
const WINDOW_SIZE = ${model.windowSize};
const WINDOW_TYPE = ${winId};
const PRESERVE_PHASE = ${model.preservePhase};
// Per-channel STFT sinusoidal frames: [startSample, dc, [bin, amp${model.preservePhase ? ', phase' : ''}, ...]]
const CHANNEL_FRAMES${isTs ? ': Array<Array<[number, number, number[]]>>' : ''} = ${JSON.stringify(compactFrames)};

${jsIfftHelper(isTs)}
${residualCode ? '\n' + residualCode + '\n' : ''}
export function generateSamples()${isTs ? ': Float32Array[]' : ''} {
  const half = FFT_SIZE >> 1;
  const halfN = FFT_SIZE * 0.5;
  const halfPi = Math.PI * 0.5;
  const twoPi = 2 * Math.PI;
  const stride = ${stride};
  const win = createWindow(WINDOW_SIZE, WINDOW_TYPE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const outputs${isTs ? ': Float32Array[]' : ''} = [];

  for (let c = 0; c < CHANNELS; c++) {
    const frames = CHANNEL_FRAMES[c] ?? [];
    const out64 = new Float64Array(NUM_SAMPLES);
    const norm64 = new Float64Array(NUM_SAMPLES);

    for (let m = 0; m < frames.length; m++) {
      const start = frames[m]${nn}[0];
      const dc = frames[m]${nn}[1];
      const bins = frames[m]${nn}[2];

      for (let i = 0; i < WINDOW_SIZE; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < NUM_SAMPLES) norm64[idx] = norm64[idx]${nn} + win[i]${nn} * win[i]${nn};
      }

      if (dc === 0 && bins.length === 0) continue;

      re.fill(0); im.fill(0);
      re[0] = FFT_SIZE * dc;
      for (let j = 0; j + stride - 1 < bins.length; j += stride) {
        const k = bins[j]${nn};
        const amp = bins[j + 1]${nn};
        const phase = PRESERVE_PHASE ? bins[j + 2]${nn} : ((twoPi * k * start) / FFT_SIZE);
        if (k === 0) re[0] = re[0]${nn} + FFT_SIZE * amp * Math.sin(phase);
        else if (k === half) re[half] = re[half]${nn} + FFT_SIZE * amp * Math.sin(phase);
        else if (k > 0 && k < half) {
          const cp = phase - halfPi;
          const r = halfN * amp * Math.cos(cp);
          const ii = halfN * amp * Math.sin(cp);
          re[k] = re[k]${nn} + r; im[k] = im[k]${nn} + ii;
          re[FFT_SIZE - k] = re[FFT_SIZE - k]${nn} + r; im[FFT_SIZE - k] = im[FFT_SIZE - k]${nn} - ii;
        }
      }

      ifftInPlace(re, im);
      for (let i = 0; i < WINDOW_SIZE; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < NUM_SAMPLES) out64[idx] = out64[idx]${nn} + re[i]${nn} * win[i]${nn};
      }
    }

    const out32 = new Float32Array(NUM_SAMPLES);
    for (let i = 0; i < NUM_SAMPLES; i++) {
      const n = norm64[i]${nn};
      out32[i] = n > 1e-12 ? out64[i]${nn} / n : 0;
    }
    outputs.push(out32);
  }${hasNoise ? '\n  addResidualNoise(outputs);' : ''}
  return outputs;
}`;
}

// ============================================================================
// Standalone ISO C99 Generator
// ============================================================================

function cIfftAndWindowHelpers(): string {
  return `static void make_window(double *w, int size, int type_id) {
  if (size <= 1) { if (size == 1) w[0] = 1.0; return; }
  for (int i = 0; i < size; i++) {
    if (type_id == 0) w[i] = 1.0;
    else if (type_id == 1) w[i] = sin(M_PI * (double)i / (double)size);
    else if (type_id == 2) w[i] = 0.5 * (1.0 - cos(TWO_PI * (double)i / (double)size));
    else if (type_id == 3) w[i] = 0.54 - 0.46 * cos(TWO_PI * (double)i / (double)size);
    else {
      double x = TWO_PI * (double)i / (double)size;
      w[i] = 0.35875 - 0.48829 * cos(x) + 0.14128 * cos(2.0 * x) - 0.01168 * cos(3.0 * x);
    }
  }
}

static void ifft_inplace(double *re, double *im, int n) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      double tr = re[i]; re[i] = re[j]; re[j] = tr;
      double ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = TWO_PI / (double)len;
    double wlen_r = cos(ang), wlen_i = sin(ang);
    int half_len = len >> 1;
    for (int i = 0; i < n; i += len) {
      double wr = 1.0, wi = 0.0;
      for (int j = 0; j < half_len; j++) {
        double ur = re[i + j], ui = im[i + j];
        double vr = re[i + j + half_len] * wr - im[i + j + half_len] * wi;
        double vi = re[i + j + half_len] * wi + im[i + j + half_len] * wr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + half_len] = ur - vr; im[i + j + half_len] = ui - vi;
        double nwr = wr * wlen_r - wi * wlen_i;
        wi = wr * wlen_i + wi * wlen_r;
        wr = nwr;
      }
    }
  }
  double inv_n = 1.0 / (double)n;
  for (int i = 0; i < n; i++) { re[i] *= inv_n; im[i] *= inv_n; }
}`;
}

function cResidualNoiseSection(
  residualNoise: ResidualNoiseChannel[] | undefined,
  includeIfft: boolean
): string {
  if (!residualNoise || residualNoise.length === 0) return '';
  const numCh = residualNoise.length;
  const numBands = residualNoise[0]!.bandEdgesHz.length - 1;
  const edges = residualNoise[0]!.bandEdgesHz.map((x) => fmtNum(x)).join(', ');
  const hop = residualNoise[0]!.hopSize;
  const maxFrames = Math.max(...residualNoise.map((r) => r.bandAmps.length));
  const seeds = residualNoise.map((r) => `${r.seed}u`).join(', ');

  const flatAmps: string[] = [];
  for (let c = 0; c < numCh; c++) {
    for (let f = 0; f < maxFrames; f++) {
      const row = residualNoise[c]!.bandAmps[f] ?? new Array(numBands).fill(0);
      for (let b = 0; b < numBands; b++) {
        flatAmps.push(fmtNum(row[b] ?? 0));
      }
    }
  }

  return `${includeIfft ? cIfftAndWindowHelpers() + '\n\n' : ''}static double mulberry32_next(uint32_t *state) {
  *state += 0x6D2B79F5u;
  uint32_t t = *state;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}

static const uint32_t RES_SEEDS[${numCh}] = { ${seeds} };
static const double RES_BAND_EDGES[${numBands + 1}] = { ${edges} };
static const double RES_BAND_AMPS[${Math.max(1, flatAmps.length)}] = { ${flatAmps.length ? flatAmps.join(', ') : '0.0'} };

static void add_residual_noise(float *out_interleaved) {
  const int fft_size = 512, half = 256, hop = ${hop}, num_bands = ${numBands}, num_frames = ${maxFrames};
  const double bin_res = (double)SOUND_SAMPLE_RATE / (double)fft_size;
  double win[512], re[512], im[512];
  make_window(win, fft_size, 1);
  int bin_to_band[257];
  for (int k = 0; k <= half; k++) {
    bin_to_band[k] = -1;
    if (k > 0) {
      double f = k * bin_res;
      for (int b = 0; b < num_bands; b++) {
        if (f >= RES_BAND_EDGES[b] && f <= RES_BAND_EDGES[b + 1]) { bin_to_band[k] = b; break; }
      }
    }
  }
  double *acc = (double *)calloc((size_t)SOUND_NUM_SAMPLES, sizeof(double));
  double *norm = (double *)calloc((size_t)SOUND_NUM_SAMPLES, sizeof(double));
  for (int c = 0; c < SOUND_CHANNELS && c < ${numCh}; c++) {
    for (int i = 0; i < SOUND_NUM_SAMPLES; i++) { acc[i] = 0.0; norm[i] = 0.0; }
    uint32_t rng = RES_SEEDS[c];
    int pad_left = fft_size - hop;
    for (int fi = 0, start = -pad_left; start < SOUND_NUM_SAMPLES && fi < num_frames; start += hop, fi++) {
      for (int i = 0; i < fft_size; i++) {
        int idx = start + i;
        if (idx >= 0 && idx < SOUND_NUM_SAMPLES) norm[idx] += win[i] * win[i];
      }
      int base = (c * num_frames + fi) * num_bands;
      int any = 0;
      for (int b = 0; b < num_bands; b++) if (RES_BAND_AMPS[base + b] > 0.0) { any = 1; break; }
      if (!any) continue;
      for (int i = 0; i < fft_size; i++) { re[i] = 0.0; im[i] = 0.0; }
      for (int k = 1; k < half; k++) {
        int b = bin_to_band[k];
        if (b < 0) continue;
        double mag = RES_BAND_AMPS[base + b] * (double)fft_size;
        if (mag <= 0.0) continue;
        double ph = mulberry32_next(&rng) * TWO_PI;
        double r = mag * cos(ph), ii = mag * sin(ph);
        re[k] = r; im[k] = ii; re[fft_size - k] = r; im[fft_size - k] = -ii;
      }
      ifft_inplace(re, im, fft_size);
      for (int i = 0; i < fft_size; i++) {
        int idx = start + i;
        if (idx >= 0 && idx < SOUND_NUM_SAMPLES) acc[idx] += re[i] * win[i];
      }
    }
    for (int i = 0; i < SOUND_NUM_SAMPLES; i++) {
      if (norm[i] > 1e-12) out_interleaved[i * SOUND_CHANNELS + c] += (float)(acc[i] / norm[i]);
    }
  }
  free(acc); free(norm);
}`;
}

function cMainCliFooter(): string {
  return `
#ifdef SOUND_MAIN
#include <string.h>
static void write_u16_le(FILE *f, uint16_t v) { fputc(v & 0xFF, f); fputc((v >> 8) & 0xFF, f); }
static void write_u32_le(FILE *f, uint32_t v) {
  fputc(v & 0xFF, f); fputc((v >> 8) & 0xFF, f); fputc((v >> 16) & 0xFF, f); fputc((v >> 24) & 0xFF, f);
}
int main(int argc, char **argv) {
  size_t total = (size_t)SOUND_NUM_SAMPLES * (size_t)SOUND_CHANNELS;
  float *buf = (float *)calloc(total > 0 ? total : 1, sizeof(float));
  if (!buf) return 1;
  sound_generate(buf);
  if (argc >= 3 && strcmp(argv[1], "--raw") == 0) {
    FILE *f = fopen(argv[2], "wb");
    if (!f) { free(buf); return 1; }
    fwrite(buf, sizeof(float), total, f);
    fclose(f);
  } else {
    const char *path = (argc >= 2) ? argv[1] : "output.wav";
    FILE *f = fopen(path, "wb");
    if (!f) { free(buf); return 1; }
    uint32_t data_bytes = (uint32_t)(total * 2);
    fwrite("RIFF", 1, 4, f); write_u32_le(f, 36 + data_bytes);
    fwrite("WAVEfmt ", 1, 8, f); write_u32_le(f, 16);
    write_u16_le(f, 1); write_u16_le(f, (uint16_t)SOUND_CHANNELS);
    write_u32_le(f, (uint32_t)SOUND_SAMPLE_RATE);
    write_u32_le(f, (uint32_t)(SOUND_SAMPLE_RATE * SOUND_CHANNELS * 2));
    write_u16_le(f, (uint16_t)(SOUND_CHANNELS * 2)); write_u16_le(f, 16);
    fwrite("data", 1, 4, f); write_u32_le(f, data_bytes);
    for (size_t i = 0; i < total; i++) {
      double s = buf[i];
      if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;
      int16_t pcm = (int16_t)(s < 0.0 ? s * 32768.0 : s * 32767.0);
      write_u16_le(f, (uint16_t)pcm);
    }
    fclose(f);
  }
  free(buf);
  return 0;
}
#endif
`;
}

export function generateMathC(model: MathSoundModel): string {
  const header = `/*
 * Standalone ISO C99 Mathematical Audio Synthesis Implementation
 * Source Name: ${sanitizeComment(model.name)}
 * Mode: ${model.mode} | Representation: ${model.representation}
 * Formula: S(t) = sum A[n] * sin(2*pi * f[n] * t + phi[n])
 * Compile CLI: gcc -O2 -DSOUND_MAIN sound.c -lm -o sound_gen
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#define TWO_PI (2.0 * M_PI)
#define HALF_PI (0.5 * M_PI)

#define SOUND_SAMPLE_RATE ${model.sampleRate}
#define SOUND_DURATION ${fmtNum(model.duration, true)}
#define SOUND_CHANNELS ${model.channels}
#define SOUND_NUM_SAMPLES ${model.length}
`;

  if (model.representation === 'procedural-math') {
    const pwTables: string[] = [];
    const pwIndices = new Map<number, number>();
    model.partials.forEach((p, idx) => {
      if (p.envelope.type === 'piecewise') {
        const pwId = pwTables.length;
        pwIndices.set(idx, pwId);
        const flat = p.envelope.points.flatMap(([t, g]) => [fmtNum(t), fmtNum(g)]).join(', ');
        pwTables.push(`static const double PW_${pwId}[${p.envelope.points.length * 2}] = { ${flat} };`);
      }
    });

    const pwHelper =
      pwTables.length > 0
        ? `\n${pwTables.join('\n')}
static double eval_piecewise(const double *pts, int count, double tau) {
  if (count <= 0) return 1.0;
  if (tau <= pts[0]) return pts[1];
  for (int i = 0; i < count - 1; i++) {
    double t0 = pts[i * 2], g0 = pts[i * 2 + 1];
    double t1 = pts[(i + 1) * 2], g1 = pts[(i + 1) * 2 + 1];
    if (tau >= t0 && tau <= t1) {
      double span = t1 - t0;
      return span <= 1e-9 ? g1 : g0 + ((tau - t0) / span) * (g1 - g0);
    }
  }
  return pts[(count - 1) * 2 + 1];
}\n`
        : '';

    const dcArr = model.dcOffset.map((d) => fmtNum(d)).join(', ');
    const evalLines: string[] = [
      `double sound_eval(double t, int channel) {`,
      `  if (t < 0.0 || t >= SOUND_DURATION) return 0.0;`,
      `  static const double dc_vals[${model.channels}] = { ${dcArr} };`,
      `  double y = (channel >= 0 && channel < SOUND_CHANNELS) ? dc_vals[channel] : 0.0;`,
    ];

    model.partials.forEach((p, idx) => {
      const chCond =
        model.channels > 1 && p.channel !== -1 ? `if (channel == ${p.channel}) ` : '';
      const tauExpr = p.startTime > 0 ? `(t - ${fmtNum(p.startTime)})` : 't';
      const phaseExpr = cFreqPhaseExpr(p.frequency, 'tau', p.duration);
      const phaseShift = Math.abs(p.phase) > 1e-12 ? ` + ${fmtNum(p.phase)}` : '';
      const envExpr = cEnvExpr(p.envelope, 'tau', pwIndices.get(idx));
      const envMul = envExpr === '1.0' ? '' : ` * ${envExpr}`;
      evalLines.push(`  ${chCond}{`);
      evalLines.push(`    double tau = ${tauExpr};`);
      evalLines.push(`    if (tau >= 0.0 && tau <= ${fmtNum(p.duration)}) {`);
      evalLines.push(`      y += ${fmtNum(p.amplitude)} * sin(${phaseExpr}${phaseShift})${envMul};`);
      evalLines.push(`    }`);
      evalLines.push(`  }`);
    });
    evalLines.push(`  return y;`, `}`);

    const noiseHelper =
      model.noiseBursts.length > 0
        ? `
static double mulberry32_next(uint32_t *state) {
  *state += 0x6D2B79F5u;
  uint32_t t = *state;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}
`
        : '';

    const noiseBodyLines: string[] = [];
    for (const nb of model.noiseBursts) {
      noiseBodyLines.push(`    if (${nb.channel} == -1 || ${nb.channel} == c) {`);
      noiseBodyLines.push(`      uint32_t rng = ${nb.seed}u;`);
      noiseBodyLines.push(`      int s0 = (int)floor(${fmtNum(nb.startTime)} * SOUND_SAMPLE_RATE);`);
      noiseBodyLines.push(`      int s1 = (int)ceil((${fmtNum(nb.startTime + nb.duration)}) * SOUND_SAMPLE_RATE);`);
      noiseBodyLines.push(`      if (s0 < 0) s0 = 0; if (s1 > SOUND_NUM_SAMPLES) s1 = SOUND_NUM_SAMPLES;`);
      noiseBodyLines.push(`      double dt = 1.0 / (double)SOUND_SAMPLE_RATE;`);
      noiseBodyLines.push(`      double rc_lp = 1.0 / (TWO_PI * ${fmtNum(Math.max(20, nb.highCutHz))});`);
      noiseBodyLines.push(`      double alpha_lp = dt / (rc_lp + dt);`);
      noiseBodyLines.push(`      double rc_hp = 1.0 / (TWO_PI * ${fmtNum(Math.max(10, nb.lowCutHz))});`);
      noiseBodyLines.push(`      double alpha_hp = rc_hp / (rc_hp + dt);`);
      noiseBodyLines.push(`      double lp = 0.0, hp = 0.0, prev_lp = 0.0;`);
      noiseBodyLines.push(`      for (int i = s0; i < s1; i++) {`);
      noiseBodyLines.push(`        double tau = (double)i / (double)SOUND_SAMPLE_RATE - ${fmtNum(nb.startTime)};`);
      noiseBodyLines.push(`        double w = mulberry32_next(&rng) * 2.0 - 1.0;`);
      noiseBodyLines.push(`        lp += alpha_lp * (w - lp);`);
      noiseBodyLines.push(`        hp = alpha_hp * (hp + lp - prev_lp);`);
      noiseBodyLines.push(`        prev_lp = lp;`);
      noiseBodyLines.push(`        double env = (1.0 - exp(-tau / ${fmtNum(Math.max(1e-4, nb.attackTime))})) * exp(${fmtNum(-nb.decayRate)} * tau);`);
      noiseBodyLines.push(`        out_interleaved[i * SOUND_CHANNELS + c] += (float)(${fmtNum(nb.amplitude)} * env * hp);`);
      noiseBodyLines.push(`      }`);
      noiseBodyLines.push(`    }`);
    }

    const genFn = `
void sound_generate(float *out_interleaved) {
  for (int c = 0; c < SOUND_CHANNELS; c++) {
    for (int i = 0; i < SOUND_NUM_SAMPLES; i++) {
      out_interleaved[i * SOUND_CHANNELS + c] = (float)sound_eval((double)i / (double)SOUND_SAMPLE_RATE, c);
    }
${noiseBodyLines.join('\n')}
  }
}`;

    return header + pwHelper + noiseHelper + '\n' + evalLines.join('\n') + '\n' + genFn + cMainCliFooter();
  }

  if (model.representation === 'sinusoidal-tracks') {
    const stride = model.preservePhase ? 3 : 2;
    const trackMeta: number[] = []; // [channel, startFrame, pointOffset, pointCount]
    const pointData: string[] = [];
    let offset = 0;
    for (let c = 0; c < model.channels; c++) {
      for (const tr of model.channelTracks[c] ?? []) {
        trackMeta.push(c, tr.startFrame, offset, tr.points.length);
        for (const pt of tr.points) {
          pointData.push(fmtNum(pt[0]), fmtNum(pt[1]));
          if (model.preservePhase) pointData.push(fmtNum(pt[2]));
        }
        offset += tr.points.length * stride;
      }
    }
    const numTracks = trackMeta.length / 4;
    const hasNoise = Boolean(model.residualNoise && model.residualNoise.length > 0);
    const resSection = cResidualNoiseSection(model.residualNoise, true);

    return `${header}
#define HOP_SIZE ${model.hopSize}
#define PRESERVE_PHASE ${model.preservePhase ? 1 : 0}
#define TRACK_STRIDE ${stride}
#define NUM_TRACKS ${numTracks}

static const double DC_OFFSET[${model.channels}] = { ${model.dcOffset.map((d) => fmtNum(d)).join(', ')} };
static const int TRACK_META[${Math.max(1, trackMeta.length)}] = { ${trackMeta.length ? trackMeta.join(', ') : '0'} };
static const double TRACK_POINTS[${Math.max(1, pointData.length)}] = { ${pointData.length ? pointData.join(', ') : '0.0'} };
${resSection ? '\n' + resSection + '\n' : ''}
static double wrap_phase(double a) {
  double r = fmod(a + M_PI, TWO_PI);
  if (r <= 0.0) r += TWO_PI;
  return r - M_PI;
}

void sound_generate(float *out_interleaved) {
  double *ch_buf = (double *)calloc((size_t)(SOUND_NUM_SAMPLES > 0 ? SOUND_NUM_SAMPLES : 1), sizeof(double));
  for (int c = 0; c < SOUND_CHANNELS; c++) {
    for (int i = 0; i < SOUND_NUM_SAMPLES; i++) ch_buf[i] = DC_OFFSET[c];
    for (int ti = 0; ti < NUM_TRACKS; ti++) {
      if (TRACK_META[ti * 4] != c) continue;
      int start_frame = TRACK_META[ti * 4 + 1];
      int pt_off = TRACK_META[ti * 4 + 2];
      int count = TRACK_META[ti * 4 + 3];
      if (count <= 0) continue;
      double run_phi = PRESERVE_PHASE ? TRACK_POINTS[pt_off + 2] : 0.0;

      if (start_frame > 0) {
        int end_s = start_frame * HOP_SIZE; if (end_s > SOUND_NUM_SAMPLES - 1) end_s = SOUND_NUM_SAMPLES - 1;
        int start_s = (start_frame - 1) * HOP_SIZE; if (start_s < 0) start_s = 0;
        int span = end_s - start_s;
        if (span > 0) {
          double w1 = TWO_PI * TRACK_POINTS[pt_off];
          double a1 = TRACK_POINTS[pt_off + 1];
          double p1 = PRESERVE_PHASE ? TRACK_POINTS[pt_off + 2] : 0.0;
          double T = (double)span / (double)SOUND_SAMPLE_RATE;
          double p0 = PRESERVE_PHASE ? (p1 - w1 * T) : 0.0;
          run_phi = PRESERVE_PHASE ? p1 : (p0 + w1 * T);
          for (int n = 0; n < span && start_s + n < SOUND_NUM_SAMPLES; n++) {
            double tau = (double)n / (double)SOUND_SAMPLE_RATE;
            ch_buf[start_s + n] += (a1 * (double)n / (double)span) * sin(p0 + w1 * tau);
          }
        }
      }

      for (int i = 0; i < count - 1; i++) {
        int s0 = (start_frame + i) * HOP_SIZE; if (s0 > SOUND_NUM_SAMPLES - 1) s0 = SOUND_NUM_SAMPLES - 1;
        int s1 = (start_frame + i + 1) * HOP_SIZE; if (s1 > SOUND_NUM_SAMPLES) s1 = SOUND_NUM_SAMPLES;
        int span = s1 - s0;
        if (span <= 0) continue;
        int o0 = pt_off + i * TRACK_STRIDE, o1 = pt_off + (i + 1) * TRACK_STRIDE;
        double w0 = TWO_PI * TRACK_POINTS[o0], a0 = TRACK_POINTS[o0 + 1], p0 = PRESERVE_PHASE ? TRACK_POINTS[o0 + 2] : 0.0;
        double w1 = TWO_PI * TRACK_POINTS[o1], a1 = TRACK_POINTS[o1 + 1], p1 = PRESERVE_PHASE ? TRACK_POINTS[o1 + 2] : 0.0;
        double T = (double)span / (double)SOUND_SAMPLE_RATE;
        if (PRESERVE_PHASE) {
          double m_star = floor(((p0 + w0 * T - p1) + 0.5 * (w1 - w0) * T) / TWO_PI + 0.5);
          double dphi = p1 - p0 - w0 * T + TWO_PI * m_star;
          double alpha = (3.0 * dphi) / (T * T) - (w1 - w0) / T;
          double beta = (-2.0 * dphi) / (T * T * T) + (w1 - w0) / (T * T);
          for (int n = 0; n < span && s0 + n < SOUND_NUM_SAMPLES; n++) {
            double tau = (double)n / (double)SOUND_SAMPLE_RATE;
            double amp = a0 + (a1 - a0) * ((double)n / (double)span);
            ch_buf[s0 + n] += amp * sin(p0 + tau * (w0 + tau * (alpha + tau * beta)));
          }
        } else {
          double slope = (w1 - w0) / (2.0 * T);
          double phi_s = run_phi;
          for (int n = 0; n < span && s0 + n < SOUND_NUM_SAMPLES; n++) {
            double tau = (double)n / (double)SOUND_SAMPLE_RATE;
            double amp = a0 + (a1 - a0) * ((double)n / (double)span);
            ch_buf[s0 + n] += amp * sin(phi_s + tau * (w0 + slope * tau));
          }
          run_phi = wrap_phase(phi_s + T * (w0 + slope * T));
        }
      }

      int last_f = start_frame + count - 1;
      int last_s = last_f * HOP_SIZE; if (last_s > SOUND_NUM_SAMPLES - 1) last_s = SOUND_NUM_SAMPLES - 1;
      if (last_s < SOUND_NUM_SAMPLES - 1) {
        int death_end = (last_f + 1) * HOP_SIZE; if (death_end > SOUND_NUM_SAMPLES) death_end = SOUND_NUM_SAMPLES;
        int span = death_end - last_s;
        if (span > 0) {
          int oL = pt_off + (count - 1) * TRACK_STRIDE;
          double wL = TWO_PI * TRACK_POINTS[oL], aL = TRACK_POINTS[oL + 1];
          double pL = PRESERVE_PHASE ? TRACK_POINTS[oL + 2] : run_phi;
          for (int n = 0; n < span && last_s + n < SOUND_NUM_SAMPLES; n++) {
            double tau = (double)n / (double)SOUND_SAMPLE_RATE;
            ch_buf[last_s + n] += aL * (1.0 - (double)n / (double)span) * sin(pL + wL * tau);
          }
        }
      }
    }
    for (int i = 0; i < SOUND_NUM_SAMPLES; i++) out_interleaved[i * SOUND_CHANNELS + c] = (float)ch_buf[i];
  }
  free(ch_buf);${hasNoise ? '\n  add_residual_noise(out_interleaved);' : ''}
}
${cMainCliFooter()}`;
  }

  // STFT Sinusoids in C
  const highPrec = model.mode === 'exact';
  const frameMeta: number[] = []; // [channel, startSample, binOffset, binCount]
  const frameDc: string[] = [];
  const binIdxArr: number[] = [];
  const binAmpArr: string[] = [];
  const binPhaseArr: string[] = [];
  let binOffset = 0;

  for (let c = 0; c < model.channels; c++) {
    for (const f of model.channelFrames[c] ?? []) {
      const count = f.bins.length / 3;
      frameMeta.push(c, f.startSample, binOffset, count);
      frameDc.push(fmtNum(f.dc, highPrec));
      for (let i = 0; i + 2 < f.bins.length; i += 3) {
        binIdxArr.push(f.bins[i]!);
        binAmpArr.push(fmtNum(f.bins[i + 1]!, highPrec));
        if (model.preservePhase) binPhaseArr.push(fmtNum(f.bins[i + 2]!, highPrec));
      }
      binOffset += count;
    }
  }

  const numFramesTotal = frameMeta.length / 4;
  const hasNoise = Boolean(model.residualNoise && model.residualNoise.length > 0);
  const resSection = cResidualNoiseSection(model.residualNoise, false);

  return `${header}
#define FFT_SIZE ${model.fftSize}
#define WINDOW_SIZE ${model.windowSize}
#define WINDOW_TYPE ${windowTypeId(model.windowType)}
#define PRESERVE_PHASE ${model.preservePhase ? 1 : 0}
#define NUM_FRAMES_TOTAL ${numFramesTotal}

static const int FRAME_META[${Math.max(1, frameMeta.length)}] = { ${frameMeta.length ? frameMeta.join(', ') : '0'} };
static const double FRAME_DC[${Math.max(1, frameDc.length)}] = { ${frameDc.length ? frameDc.join(', ') : '0.0'} };
static const uint16_t BIN_IDX[${Math.max(1, binIdxArr.length)}] = { ${binIdxArr.length ? binIdxArr.join(', ') : '0'} };
static const double BIN_AMP[${Math.max(1, binAmpArr.length)}] = { ${binAmpArr.length ? binAmpArr.join(', ') : '0.0'} };
${model.preservePhase ? `static const double BIN_PHASE[${Math.max(1, binPhaseArr.length)}] = { ${binPhaseArr.length ? binPhaseArr.join(', ') : '0.0'} };` : ''}

${cIfftAndWindowHelpers()}
${resSection ? '\n' + resSection + '\n' : ''}
void sound_generate(float *out_interleaved) {
  const int half = FFT_SIZE >> 1;
  const double half_n = (double)FFT_SIZE * 0.5;
  double *win = (double *)calloc(WINDOW_SIZE, sizeof(double));
  double *re = (double *)calloc(FFT_SIZE, sizeof(double));
  double *im = (double *)calloc(FFT_SIZE, sizeof(double));
  double *out64 = (double *)calloc((size_t)(SOUND_NUM_SAMPLES > 0 ? SOUND_NUM_SAMPLES : 1), sizeof(double));
  double *norm64 = (double *)calloc((size_t)(SOUND_NUM_SAMPLES > 0 ? SOUND_NUM_SAMPLES : 1), sizeof(double));
  make_window(win, WINDOW_SIZE, WINDOW_TYPE);

  for (int c = 0; c < SOUND_CHANNELS; c++) {
    for (int i = 0; i < SOUND_NUM_SAMPLES; i++) { out64[i] = 0.0; norm64[i] = 0.0; }
    for (int m = 0; m < NUM_FRAMES_TOTAL; m++) {
      if (FRAME_META[m * 4] != c) continue;
      int start = FRAME_META[m * 4 + 1];
      int off = FRAME_META[m * 4 + 2];
      int cnt = FRAME_META[m * 4 + 3];
      double dc = FRAME_DC[m];

      for (int i = 0; i < WINDOW_SIZE; i++) {
        int idx = start + i;
        if (idx >= 0 && idx < SOUND_NUM_SAMPLES) norm64[idx] += win[i] * win[i];
      }
      if (dc == 0.0 && cnt == 0) continue;

      for (int i = 0; i < FFT_SIZE; i++) { re[i] = 0.0; im[i] = 0.0; }
      re[0] = (double)FFT_SIZE * dc;
      for (int j = 0; j < cnt; j++) {
        int k = (int)BIN_IDX[off + j];
        double amp = BIN_AMP[off + j];
        double phase = ${model.preservePhase ? 'BIN_PHASE[off + j]' : '(TWO_PI * (double)k * (double)start / (double)FFT_SIZE)'};
        if (k == 0) re[0] += (double)FFT_SIZE * amp * sin(phase);
        else if (k == half) re[half] += (double)FFT_SIZE * amp * sin(phase);
        else if (k > 0 && k < half) {
          double cp = phase - HALF_PI;
          double r = half_n * amp * cos(cp);
          double ii = half_n * amp * sin(cp);
          re[k] += r; im[k] += ii;
          re[FFT_SIZE - k] += r; im[FFT_SIZE - k] -= ii;
        }
      }
      ifft_inplace(re, im, FFT_SIZE);
      for (int i = 0; i < WINDOW_SIZE; i++) {
        int idx = start + i;
        if (idx >= 0 && idx < SOUND_NUM_SAMPLES) out64[idx] += re[i] * win[i];
      }
    }
    for (int i = 0; i < SOUND_NUM_SAMPLES; i++) {
      out_interleaved[i * SOUND_CHANNELS + c] = (float)(norm64[i] > 1e-12 ? out64[i] / norm64[i] : 0.0);
    }
  }
  free(win); free(re); free(im); free(out64); free(norm64);${hasNoise ? '\n  add_residual_noise(out_interleaved);' : ''}
}
${cMainCliFooter()}`;
}

// ============================================================================
// Standalone C++17 Generator
// ============================================================================

export function generateMathCpp(model: MathSoundModel): string {
  // Embed the clean ISO C99 synthesis core inside a C++17 namespace with idiomatic std::vector API!
  const cCore = generateMathC(model)
    .replace(/#ifdef SOUND_MAIN[\s\S]*#endif\s*$/, '')
    .replace(/#include <math\.h>\n#include <stdint\.h>\n#include <stdio\.h>\n#include <stdlib\.h>/, '')
    .trim();

  const evalForward =
    model.representation === 'procedural-math'
      ? `\ninline double sound(double t, int channel = 0) { return detail::sound_eval(t, channel); }\n`
      : '';

  return `// Standalone C++17 Mathematical Audio Synthesis Implementation
// Source Name: ${sanitizeComment(model.name)}
// Mode: ${model.mode} | Representation: ${model.representation}
// Compile CLI: g++ -std=c++17 -O2 -DSOUND_MAIN sound.cpp -o sound_gen

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <vector>

namespace sound_math {

constexpr int SAMPLE_RATE = ${model.sampleRate};
constexpr double DURATION = ${fmtNum(model.duration, true)};
constexpr int CHANNELS = ${model.channels};
constexpr int NUM_SAMPLES = ${model.length};

namespace detail {
${cCore}
} // namespace detail
${evalForward}
inline std::vector<std::vector<float>> generateSamples() {
  std::vector<float> interleaved(static_cast<size_t>(NUM_SAMPLES) * CHANNELS, 0.0f);
  detail::sound_generate(interleaved.data());
  std::vector<std::vector<float>> channels(CHANNELS, std::vector<float>(NUM_SAMPLES, 0.0f));
  for (int i = 0; i < NUM_SAMPLES; ++i) {
    for (int c = 0; c < CHANNELS; ++c) {
      channels[c][i] = interleaved[static_cast<size_t>(i) * CHANNELS + c];
    }
  }
  return channels;
}

} // namespace sound_math

#ifdef SOUND_MAIN
int main(int argc, char** argv) {
  auto chs = sound_math::generateSamples();
  std::vector<float> interleaved(static_cast<size_t>(sound_math::NUM_SAMPLES) * sound_math::CHANNELS);
  for (int i = 0; i < sound_math::NUM_SAMPLES; ++i) {
    for (int c = 0; c < sound_math::CHANNELS; ++c) {
      interleaved[static_cast<size_t>(i) * sound_math::CHANNELS + c] = chs[c][i];
    }
  }
  if (argc >= 3 && std::strcmp(argv[1], "--raw") == 0) {
    std::ofstream out(argv[2], std::ios::binary);
    out.write(reinterpret_cast<const char*>(interleaved.data()),
              static_cast<std::streamsize>(interleaved.size() * sizeof(float)));
    return out.good() ? 0 : 1;
  }
  const char* path = (argc >= 2) ? argv[1] : "output.wav";
  std::ofstream out(path, std::ios::binary);
  uint32_t data_bytes = static_cast<uint32_t>(interleaved.size() * 2);
  auto wu16 = [&](uint16_t v) { char b[2] = {char(v & 0xFF), char((v >> 8) & 0xFF)}; out.write(b, 2); };
  auto wu32 = [&](uint32_t v) {
    char b[4] = {char(v & 0xFF), char((v >> 8) & 0xFF), char((v >> 16) & 0xFF), char((v >> 24) & 0xFF)};
    out.write(b, 4);
  };
  out.write("RIFF", 4); wu32(36 + data_bytes);
  out.write("WAVEfmt ", 8); wu32(16);
  wu16(1); wu16(static_cast<uint16_t>(sound_math::CHANNELS));
  wu32(static_cast<uint32_t>(sound_math::SAMPLE_RATE));
  wu32(static_cast<uint32_t>(sound_math::SAMPLE_RATE * sound_math::CHANNELS * 2));
  wu16(static_cast<uint16_t>(sound_math::CHANNELS * 2)); wu16(16);
  out.write("data", 4); wu32(data_bytes);
  for (float s : interleaved) {
    double clamped = s > 1.0f ? 1.0 : (s < -1.0f ? -1.0 : static_cast<double>(s));
    int16_t pcm = static_cast<int16_t>(clamped < 0.0 ? clamped * 32768.0 : clamped * 32767.0);
    wu16(static_cast<uint16_t>(pcm));
  }
  return out.good() ? 0 : 1;
}
#endif
`;
}

// ============================================================================
// Standalone Python 3 Stdlib Generator (zero third-party deps!)
// ============================================================================

function pyIfftAndWindowHelpers(): string {
  return `def _make_window(size, type_id):
    if size <= 1:
        return [1.0] * size
    if type_id == 0:
        return [1.0] * size
    if type_id == 1:
        return [math.sin(math.pi * i / size) for i in range(size)]
    if type_id == 2:
        return [0.5 * (1.0 - math.cos(TWO_PI * i / size)) for i in range(size)]
    if type_id == 3:
        return [0.54 - 0.46 * math.cos(TWO_PI * i / size) for i in range(size)]
    return [
        0.35875 - 0.48829 * math.cos(TWO_PI * i / size)
        + 0.14128 * math.cos(2.0 * TWO_PI * i / size)
        - 0.01168 * math.cos(3.0 * TWO_PI * i / size)
        for i in range(size)
    ]

def _ifft_inplace(re, im):
    n = len(re)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]
    length = 2
    while length <= n:
        ang = TWO_PI / length
        wlen_r = math.cos(ang)
        wlen_i = math.sin(ang)
        half_len = length >> 1
        for i in range(0, n, length):
            wr, wi = 1.0, 0.0
            for k in range(half_len):
                u_r, u_i = re[i + k], im[i + k]
                idx2 = i + k + half_len
                v_r = re[idx2] * wr - im[idx2] * wi
                v_i = re[idx2] * wi + im[idx2] * wr
                re[i + k] = u_r + v_r
                im[i + k] = u_i + v_i
                re[idx2] = u_r - v_r
                im[idx2] = u_i - v_i
                wr, wi = wr * wlen_r - wi * wlen_i, wr * wlen_i + wi * wlen_r
        length <<= 1
    inv_n = 1.0 / n
    for i in range(n):
        re[i] *= inv_n
        im[i] *= inv_n`;
}

function pyMulberry32Helper(): string {
  return `def _mulberry32(seed):
    s = seed & 0xFFFFFFFF
    def next_val():
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((s ^ (s >> 15)) * (s | 1)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) ^ t) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    return next_val`;
}

function pyResidualNoiseSection(
  residualNoise: ResidualNoiseChannel[] | undefined,
  includeIfft: boolean
): string {
  if (!residualNoise || residualNoise.length === 0) return '';
  return `${includeIfft ? pyIfftAndWindowHelpers() + '\n\n' : ''}${pyMulberry32Helper()}

RESIDUAL_NOISE = ${JSON.stringify(residualNoise)}

def _add_residual_noise(outputs):
    fft_size, half = 512, 256
    bin_res = SAMPLE_RATE / fft_size
    win = _make_window(fft_size, 1)
    for c in range(min(len(outputs), len(RESIDUAL_NOISE))):
        out = outputs[c]
        m = RESIDUAL_NOISE[c]
        rng = _mulberry32(m["seed"])
        edges = m["bandEdgesHz"]
        num_bands = len(edges) - 1
        bin_to_band = [-1] * (half + 1)
        for k in range(1, half + 1):
            f = k * bin_res
            for b in range(num_bands):
                if edges[b] <= f <= edges[b + 1]:
                    bin_to_band[k] = b
                    break
        hop = m["hopSize"]
        pad_left = fft_size - hop
        acc = [0.0] * NUM_SAMPLES
        norm = [0.0] * NUM_SAMPLES
        band_amps = m["bandAmps"]
        fi = 0
        start = -pad_left
        while start < NUM_SAMPLES and fi < len(band_amps):
            for i in range(fft_size):
                idx = start + i
                if 0 <= idx < NUM_SAMPLES:
                    norm[idx] += win[i] * win[i]
            bands = band_amps[fi]
            if any(v > 0.0 for v in bands):
                re = [0.0] * fft_size
                im = [0.0] * fft_size
                for k in range(1, half):
                    b = bin_to_band[k]
                    if b < 0:
                        continue
                    mag = bands[b] * fft_size
                    if mag <= 0.0:
                        continue
                    ph = rng() * TWO_PI
                    r = mag * math.cos(ph)
                    ii = mag * math.sin(ph)
                    re[k], im[k] = r, ii
                    re[fft_size - k], im[fft_size - k] = r, -ii
                _ifft_inplace(re, im)
                for i in range(fft_size):
                    idx = start + i
                    if 0 <= idx < NUM_SAMPLES:
                        acc[idx] += re[i] * win[i]
            start += hop
            fi += 1
        for i in range(NUM_SAMPLES):
            if norm[i] > 1e-12:
                out[i] += acc[i] / norm[i]`;
}

function pyCliFooter(): string {
  return `
def write_wav(path):
    channels = generate_samples()
    with wave.open(path, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for i in range(NUM_SAMPLES):
            for c in range(CHANNELS):
                s = max(-1.0, min(1.0, channels[c][i]))
                pcm = int(s * 32768.0) if s < 0.0 else int(s * 32767.0)
                pcm = max(-32768, min(32767, pcm))
                frames += struct.pack("<h", pcm)
        wf.writeframes(bytes(frames))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--raw":
        channels = generate_samples()
        with open(sys.argv[2], "wb") as f:
            for i in range(NUM_SAMPLES):
                for c in range(CHANNELS):
                    f.write(struct.pack("<f", channels[c][i]))
    else:
        out_path = sys.argv[1] if len(sys.argv) >= 2 else "output.wav"
        write_wav(out_path)
`;
}

export function generateMathPython(model: MathSoundModel): string {
  const header = `"""
Standalone Python 3 Mathematical Audio Synthesis Module (stdlib only)
Source Name: ${sanitizeComment(model.name)}
Mode: ${model.mode} | Representation: ${model.representation}
Formula: S(t) = sum A[n] * sin(2*pi * f[n] * t + phi[n])
Zero external packages, zero embedded PCM/WAV/Base64 assets.
"""
import math
import struct
import sys
import wave

TWO_PI = 2.0 * math.pi
HALF_PI = 0.5 * math.pi

SAMPLE_RATE = ${model.sampleRate}
DURATION = ${fmtNum(model.duration, true)}
CHANNELS = ${model.channels}
NUM_SAMPLES = ${model.length}
MODE = "${model.mode}"
REPRESENTATION = "${model.representation}"
`;

  if (model.representation === 'procedural-math') {
    const needsPw = model.partials.some((p) => p.envelope.type === 'piecewise');
    const needsNoise = model.noiseBursts.length > 0;
    const pwCode = needsPw
      ? `
def eval_piecewise(pts, tau):
    if not pts:
        return 1.0
    if tau <= pts[0][0]:
        return pts[0][1]
    for i in range(len(pts) - 1):
        t0, g0 = pts[i]
        t1, g1 = pts[i + 1]
        if t0 <= tau <= t1:
            span = t1 - t0
            return g1 if span <= 1e-9 else g0 + ((tau - t0) / span) * (g1 - g0)
    return pts[-1][1]
`
      : '';
    const rngCode = needsNoise ? '\n' + pyMulberry32Helper() + '\n' : '';
    const dcLit = JSON.stringify(model.dcOffset);

    const soundLines: string[] = [
      `def sound(t, channel=0):`,
      `    if t < 0.0 or t >= DURATION:`,
      `        return 0.0`,
      `    dc_vals = ${dcLit}`,
      `    y = dc_vals[channel] if 0 <= channel < len(dc_vals) else 0.0`,
    ];

    for (const p of model.partials) {
      const chCheck = model.channels > 1 && p.channel !== -1;
      const ind = chCheck ? '        ' : '    ';
      if (chCheck) soundLines.push(`    if channel == ${p.channel}:`);
      const tauExpr = p.startTime > 0 ? `t - ${fmtNum(p.startTime)}` : 't';
      const phaseExpr = pyFreqPhaseExpr(p.frequency, 'tau', p.duration);
      const phaseShift = Math.abs(p.phase) > 1e-12 ? ` + ${fmtNum(p.phase)}` : '';
      const envExpr = pyEnvExpr(p.envelope, 'tau');
      const envMul = envExpr === '1.0' ? '' : ` * ${envExpr}`;
      soundLines.push(`${ind}tau = ${tauExpr}`);
      soundLines.push(`${ind}if 0.0 <= tau <= ${fmtNum(p.duration)}:`);
      soundLines.push(`${ind}    y += ${fmtNum(p.amplitude)} * math.sin(${phaseExpr}${phaseShift})${envMul}`);
    }
    soundLines.push(`    return y`);

    const noiseLit = needsNoise ? `\nNOISE_BURSTS = ${JSON.stringify(model.noiseBursts)}\n` : '';
    const noiseLoop = needsNoise
      ? `        for nb in NOISE_BURSTS:
            if nb["channel"] != -1 and nb["channel"] != c:
                continue
            rng = _mulberry32(nb["seed"])
            s0 = max(0, int(math.floor(nb["startTime"] * SAMPLE_RATE)))
            s1 = min(NUM_SAMPLES, int(math.ceil((nb["startTime"] + nb["duration"]) * SAMPLE_RATE)))
            dt = 1.0 / SAMPLE_RATE
            rc_lp = 1.0 / (TWO_PI * max(20.0, nb["highCutHz"]))
            alpha_lp = dt / (rc_lp + dt)
            rc_hp = 1.0 / (TWO_PI * max(10.0, nb["lowCutHz"]))
            alpha_hp = rc_hp / (rc_hp + dt)
            lp = hp = prev_lp = 0.0
            for i in range(s0, s1):
                tau = i / SAMPLE_RATE - nb["startTime"]
                w = rng() * 2.0 - 1.0
                lp += alpha_lp * (w - lp)
                hp = alpha_hp * (hp + lp - prev_lp)
                prev_lp = lp
                env = (1.0 - math.exp(-tau / max(1e-4, nb["attackTime"]))) * math.exp(-nb["decayRate"] * tau)
                out[i] += nb["amplitude"] * env * hp\n`
      : '';

    const genCode = `
def generate_samples():
    outputs = []
    for c in range(CHANNELS):
        out = [sound(i / SAMPLE_RATE, c) for i in range(NUM_SAMPLES)]
${noiseLoop}        outputs.append(out)
    return outputs
`;

    return header + pwCode + rngCode + noiseLit + '\n' + soundLines.join('\n') + '\n' + genCode + pyCliFooter();
  }

  if (model.representation === 'sinusoidal-tracks') {
    const stride = model.preservePhase ? 3 : 2;
    const compactChannels = model.channelTracks.map((tracks) =>
      tracks.map((tr) => {
        const flat: number[] = [];
        for (const pt of tr.points) {
          flat.push(pt[0], pt[1]);
          if (model.preservePhase) flat.push(pt[2]);
        }
        return [tr.startFrame, flat];
      })
    );
    const hasNoise = Boolean(model.residualNoise && model.residualNoise.length > 0);
    const resCode = pyResidualNoiseSection(model.residualNoise, true);

    return `${header}
HOP_SIZE = ${model.hopSize}
PRESERVE_PHASE = ${model.preservePhase ? 'True' : 'False'}
DC_OFFSET = ${JSON.stringify(model.dcOffset)}
CHANNEL_TRACKS = ${JSON.stringify(compactChannels)}
${resCode ? '\n' + resCode + '\n' : ''}
def _wrap_phase(a):
    r = (a + math.pi) % TWO_PI
    if r <= 0.0:
        r += TWO_PI
    return r - math.pi

def generate_samples():
    stride = ${stride}
    outputs = []
    for c in range(CHANNELS):
        out = [DC_OFFSET[c] if c < len(DC_OFFSET) else 0.0] * NUM_SAMPLES
        tracks = CHANNEL_TRACKS[c] if c < len(CHANNEL_TRACKS) else []
        for start_frame, flat in tracks:
            count = len(flat) // stride
            if count == 0:
                continue
            run_phi = flat[2] if PRESERVE_PHASE else 0.0
            if start_frame > 0:
                end_s = min(NUM_SAMPLES - 1, start_frame * HOP_SIZE)
                start_s = max(0, (start_frame - 1) * HOP_SIZE)
                span = end_s - start_s
                if span > 0:
                    w1, a1 = TWO_PI * flat[0], flat[1]
                    p1 = flat[2] if PRESERVE_PHASE else 0.0
                    T = span / SAMPLE_RATE
                    p0 = p1 - w1 * T if PRESERVE_PHASE else 0.0
                    run_phi = p1 if PRESERVE_PHASE else p0 + w1 * T
                    for n in range(span):
                        idx = start_s + n
                        if idx >= NUM_SAMPLES:
                            break
                        out[idx] += (a1 * n / span) * math.sin(p0 + w1 * (n / SAMPLE_RATE))

            for i in range(count - 1):
                s0 = min(NUM_SAMPLES - 1, (start_frame + i) * HOP_SIZE)
                s1 = min(NUM_SAMPLES, (start_frame + i + 1) * HOP_SIZE)
                span = s1 - s0
                if span <= 0:
                    continue
                o0, o1 = i * stride, (i + 1) * stride
                w0, a0 = TWO_PI * flat[o0], flat[o0 + 1]
                p0 = flat[o0 + 2] if PRESERVE_PHASE else 0.0
                w1, a1 = TWO_PI * flat[o1], flat[o1 + 1]
                p1 = flat[o1 + 2] if PRESERVE_PHASE else 0.0
                T = span / SAMPLE_RATE
                if PRESERVE_PHASE:
                    m_star = math.floor(((p0 + w0 * T - p1) + 0.5 * (w1 - w0) * T) / TWO_PI + 0.5)
                    dphi = p1 - p0 - w0 * T + TWO_PI * m_star
                    alpha = (3.0 * dphi) / (T * T) - (w1 - w0) / T
                    beta = (-2.0 * dphi) / (T * T * T) + (w1 - w0) / (T * T)
                    for n in range(span):
                        idx = s0 + n
                        if idx >= NUM_SAMPLES:
                            break
                        tau = n / SAMPLE_RATE
                        amp = a0 + (a1 - a0) * (n / span)
                        out[idx] += amp * math.sin(p0 + tau * (w0 + tau * (alpha + tau * beta)))
                else:
                    slope = (w1 - w0) / (2.0 * T)
                    phi_s = run_phi
                    for n in range(span):
                        idx = s0 + n
                        if idx >= NUM_SAMPLES:
                            break
                        tau = n / SAMPLE_RATE
                        amp = a0 + (a1 - a0) * (n / span)
                        out[idx] += amp * math.sin(phi_s + tau * (w0 + slope * tau))
                    run_phi = _wrap_phase(phi_s + T * (w0 + slope * T))

            last_f = start_frame + count - 1
            last_s = min(NUM_SAMPLES - 1, last_f * HOP_SIZE)
            if last_s < NUM_SAMPLES - 1:
                death_end = min(NUM_SAMPLES, (last_f + 1) * HOP_SIZE)
                span = death_end - last_s
                if span > 0:
                    oL = (count - 1) * stride
                    wL, aL = TWO_PI * flat[oL], flat[oL + 1]
                    pL = flat[oL + 2] if PRESERVE_PHASE else run_phi
                    for n in range(span):
                        idx = last_s + n
                        if idx >= NUM_SAMPLES:
                            break
                        out[idx] += aL * (1.0 - n / span) * math.sin(pL + wL * (n / SAMPLE_RATE))
        outputs.append(out)${hasNoise ? '\n    _add_residual_noise(outputs)' : ''}
    return outputs
${pyCliFooter()}`;
  }

  // STFT Sinusoids in Python
  const highPrec = model.mode === 'exact';
  const stride = model.preservePhase ? 3 : 2;
  const compactFrames = model.channelFrames.map((frames) =>
    frames.map((f) => {
      const bins: number[] = [];
      for (let i = 0; i + 2 < f.bins.length; i += 3) {
        bins.push(f.bins[i]!, Number(fmtNum(f.bins[i + 1]!, highPrec)));
        if (model.preservePhase) bins.push(Number(fmtNum(f.bins[i + 2]!, highPrec)));
      }
      return [f.startSample, Number(fmtNum(f.dc, highPrec)), bins];
    })
  );
  const hasNoise = Boolean(model.residualNoise && model.residualNoise.length > 0);
  const resCode = pyResidualNoiseSection(model.residualNoise, false);

  return `${header}
FFT_SIZE = ${model.fftSize}
WINDOW_SIZE = ${model.windowSize}
WINDOW_TYPE = ${windowTypeId(model.windowType)}
PRESERVE_PHASE = ${model.preservePhase ? 'True' : 'False'}
CHANNEL_FRAMES = ${JSON.stringify(compactFrames)}

${pyIfftAndWindowHelpers()}
${resCode ? '\n' + resCode + '\n' : ''}
def generate_samples():
    half = FFT_SIZE >> 1
    half_n = FFT_SIZE * 0.5
    stride = ${stride}
    win = _make_window(WINDOW_SIZE, WINDOW_TYPE)
    outputs = []
    for c in range(CHANNELS):
        frames = CHANNEL_FRAMES[c] if c < len(CHANNEL_FRAMES) else []
        out = [0.0] * NUM_SAMPLES
        norm = [0.0] * NUM_SAMPLES
        for start, dc, bins in frames:
            for i in range(WINDOW_SIZE):
                idx = start + i
                if 0 <= idx < NUM_SAMPLES:
                    norm[idx] += win[i] * win[i]
            if dc == 0.0 and not bins:
                continue
            re = [0.0] * FFT_SIZE
            im = [0.0] * FFT_SIZE
            re[0] = FFT_SIZE * dc
            for j in range(0, len(bins) - stride + 1, stride):
                k = bins[j]
                amp = bins[j + 1]
                phase = bins[j + 2] if PRESERVE_PHASE else (TWO_PI * k * start / FFT_SIZE)
                if k == 0:
                    re[0] += FFT_SIZE * amp * math.sin(phase)
                elif k == half:
                    re[half] += FFT_SIZE * amp * math.sin(phase)
                elif 0 < k < half:
                    cp = phase - HALF_PI
                    r = half_n * amp * math.cos(cp)
                    ii = half_n * amp * math.sin(cp)
                    re[k] += r
                    im[k] += ii
                    re[FFT_SIZE - k] += r
                    im[FFT_SIZE - k] -= ii
            _ifft_inplace(re, im)
            for i in range(WINDOW_SIZE):
                idx = start + i
                if 0 <= idx < NUM_SAMPLES:
                    out[idx] += re[i] * win[i]
        for i in range(NUM_SAMPLES):
            out[i] = out[i] / norm[i] if norm[i] > 1e-12 else 0.0
        outputs.append(out)${hasNoise ? '\n    _add_residual_noise(outputs)' : ''}
    return outputs
${pyCliFooter()}`;
}

/**
 * Unified export generator dispatcher for all 6 standalone formats.
 */
export function generateMathExport(model: MathSoundModel, language: ExportLanguage): string {
  switch (language) {
    case 'js':
      return generateMathJsOrTs(model, false);
    case 'ts':
      return generateMathJsOrTs(model, true);
    case 'c':
      return generateMathC(model);
    case 'cpp':
      return generateMathCpp(model);
    case 'python':
      return generateMathPython(model);
    case 'json':
      return generateMathJson(model, true);
  }
}

export function getExportFileExtension(language: ExportLanguage): string {
  switch (language) {
    case 'js':
      return '.sound.js';
    case 'ts':
      return '.sound.ts';
    case 'c':
      return '.sound.c';
    case 'cpp':
      return '.sound.cpp';
    case 'python':
      return '.sound.py';
    case 'json':
      return '.math.json';
  }
}
