import {
  ProceduralEnvelopeLaw,
  ProceduralFrequencyLaw,
  ProceduralMathModel,
  ProceduralNoiseBurst,
  ProceduralPartial,
  ReconstructionConfig,
} from '@/types/mathModel';
import { SoundLayer, SoundRecipe } from '@/types/recipe';
import { getCachedFFT, nextPowerOf2, TWO_PI, wrapPhase } from '@/audio/analysis/fft';
import { analyzeAudioSamples, SILENCE_PEAK_THRESHOLD } from '@/audio/analysis/analyzer';
import { createSeededRandom } from '@/audio/synthesis/noise';
import { analyzeToSinusoidalTracks } from './sinusoidalTracksEngine';
import { roundSig } from './stftEngine';

/**
 * Evaluates exact analytical instantaneous phase theta(tau) for a ProceduralFrequencyLaw.
 */
export function evalFrequencyPhase(
  law: ProceduralFrequencyLaw,
  tau: number,
  duration: number
): number {
  switch (law.type) {
    case 'constant':
      return TWO_PI * law.freq * tau;
    case 'linear': {
      const d = Math.max(1e-6, duration);
      return TWO_PI * (law.startFreq * tau + (0.5 * (law.endFreq - law.startFreq) * tau * tau) / d);
    }
    case 'exponential': {
      const d = Math.max(1e-6, duration);
      const f0 = Math.max(1, law.startFreq);
      const f1 = Math.max(1, law.endFreq);
      const ratio = f1 / f0;
      if (Math.abs(ratio - 1) < 1e-4) {
        return TWO_PI * f0 * tau;
      }
      const lnR = Math.log(ratio);
      return ((TWO_PI * f0 * d) / lnR) * (Math.pow(ratio, tau / d) - 1);
    }
    case 'fm': {
      const fm = Math.max(0.1, law.modFreq);
      const beta = law.modDepth / fm;
      return (
        TWO_PI * law.carrierFreq * tau +
        beta * (Math.sin(TWO_PI * fm * tau + law.modPhase) - Math.sin(law.modPhase))
      );
    }
  }
}

/**
 * Evaluates exact analytical amplitude envelope env(tau) in [0..~2] for a ProceduralEnvelopeLaw.
 */
export function evalEnvelopeLaw(law: ProceduralEnvelopeLaw, tau: number): number {
  if (tau < 0) return 0;
  switch (law.type) {
    case 'constant':
      return 1;
    case 'exp-decay':
      return Math.exp(-law.decayRate * tau);
    case 'attack-decay': {
      const atk = 1 - Math.exp(-tau / Math.max(1e-4, law.attackTime));
      const dec = Math.exp(-law.decayRate * tau);
      return atk * dec;
    }
    case 'am': {
      const mod = 1 + law.amDepth * Math.sin(TWO_PI * law.amFreq * tau + law.amPhase);
      return Math.max(0, mod) * Math.exp(-law.decayRate * tau);
    }
    case 'piecewise': {
      const pts = law.points;
      if (pts.length === 0) return 1;
      if (tau <= pts[0]![0]) return pts[0]![1];
      for (let i = 0; i < pts.length - 1; i++) {
        const [t0, g0] = pts[i]!;
        const [t1, g1] = pts[i + 1]!;
        if (tau >= t0 && tau <= t1) {
          const span = t1 - t0;
          if (span <= 1e-9) return g1;
          return g0 + ((tau - t0) / span) * (g1 - g0);
        }
      }
      return pts[pts.length - 1]![1];
    }
  }
}

/**
 * Projects a target residual channel onto basis {env(tau)*sin(theta(tau)), env(tau)*cos(theta(tau))}
 * to find the closed-form optimal (amplitude, phase) minimizing L2 residual error!
 */
function projectOptimalAmpPhase(
  residual: Float64Array,
  sampleRate: number,
  startTime: number,
  duration: number,
  freqLaw: ProceduralFrequencyLaw,
  envLaw: ProceduralEnvelopeLaw,
  preservePhase: boolean
): { amplitude: number; phase: number; capturedEnergy: number } {
  const s0 = Math.max(0, Math.floor(startTime * sampleRate));
  const s1 = Math.min(residual.length, Math.ceil((startTime + duration) * sampleRate));
  if (s1 <= s0) return { amplitude: 0, phase: 0, capturedEnergy: 0 };

  let dotSin = 0;
  let dotCos = 0;
  let normSin = 0;
  let normCos = 0;
  let crossSinCos = 0;

  for (let i = s0; i < s1; i++) {
    const tau = i / sampleRate - startTime;
    const e = evalEnvelopeLaw(envLaw, tau);
    if (e < 1e-6) continue;
    const th = evalFrequencyPhase(freqLaw, tau, duration);
    const u = e * Math.sin(th);
    const v = e * Math.cos(th);
    const r = residual[i]!;
    dotSin += r * u;
    dotCos += r * v;
    normSin += u * u;
    normCos += v * v;
    crossSinCos += u * v;
  }

  // Solve 2x2 normal equations [normSin, cross; cross, normCos] [aS; aC] = [dotSin; dotCos]
  const det = normSin * normCos - crossSinCos * crossSinCos;
  if (Math.abs(det) < 1e-12) {
    return { amplitude: 0, phase: 0, capturedEnergy: 0 };
  }

  const aS = (normCos * dotSin - crossSinCos * dotCos) / det;
  const aC = (-crossSinCos * dotSin + normSin * dotCos) / det;
  const amplitude = Math.hypot(aS, aC);
  const phase = preservePhase ? wrapPhase(Math.atan2(aC, aS)) : 0;

  // Captured energy = aS * dotSin + aC * dotCos
  const capturedEnergy = Math.max(0, aS * dotSin + aC * dotCos);
  return { amplitude, phase, capturedEnergy };
}

/**
 * Fits the best compact frequency law (constant, linear, exponential, or sinusoidal FM)
 * to a track's observed frequency trajectory.
 */
function fitFrequencyLaw(
  freqs: number[],
  amps: number[],
  hopDuration: number,
  duration: number
): ProceduralFrequencyLaw {
  const n = freqs.length;
  if (n <= 1) {
    return { type: 'constant', freq: freqs[0] ?? 440 };
  }

  // Weighted mean frequency (constant model)
  let weightSum = 0;
  let wFreqSum = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.max(1e-6, amps[i]! * amps[i]!);
    weightSum += w;
    wFreqSum += w * freqs[i]!;
  }
  const meanFreq = wFreqSum / weightSum;

  // Compute constant MSE
  let constMse = 0;
  for (let i = 0; i < n; i++) {
    const d = freqs[i]! - meanFreq;
    constMse += d * d;
  }
  constMse /= n;

  // If frequency variance is < 1.2% of mean frequency, constant is optimal
  const relStd = Math.sqrt(constMse) / Math.max(20, meanFreq);
  if (relStd < 0.012) {
    return { type: 'constant', freq: meanFreq };
  }

  // Linear regression on f(t) vs t
  let sumT = 0;
  let sumT2 = 0;
  let sumF = 0;
  let sumTF = 0;
  let wSum = 0;
  for (let i = 0; i < n; i++) {
    const t = i * hopDuration;
    const w = Math.max(1e-6, amps[i]!);
    wSum += w;
    sumT += w * t;
    sumT2 += w * t * t;
    sumF += w * freqs[i]!;
    sumTF += w * t * freqs[i]!;
  }
  const denom = wSum * sumT2 - sumT * sumT;
  const slope = Math.abs(denom) > 1e-12 ? (wSum * sumTF - sumT * sumF) / denom : 0;
  const intercept = (sumF - slope * sumT) / wSum;
  const linStart = Math.max(15, intercept);
  const linEnd = Math.max(15, intercept + slope * duration);

  let linMse = 0;
  for (let i = 0; i < n; i++) {
    const t = i * hopDuration;
    const pred = linStart + ((linEnd - linStart) * t) / Math.max(1e-6, duration);
    const d = freqs[i]! - pred;
    linMse += d * d;
  }
  linMse /= n;

  // Exponential regression on ln(f(t)) vs t
  let sumLnF = 0;
  let sumTLnF = 0;
  for (let i = 0; i < n; i++) {
    const t = i * hopDuration;
    const w = Math.max(1e-6, amps[i]!);
    const lnf = Math.log(Math.max(15, freqs[i]!));
    sumLnF += w * lnf;
    sumTLnF += w * t * lnf;
  }
  const expSlope = Math.abs(denom) > 1e-12 ? (wSum * sumTLnF - sumT * sumLnF) / denom : 0;
  const expIntercept = (sumLnF - expSlope * sumT) / wSum;
  const expStart = Math.max(15, Math.exp(expIntercept));
  const expEnd = Math.max(15, Math.exp(expIntercept + expSlope * duration));

  let expMse = 0;
  for (let i = 0; i < n; i++) {
    const t = i * hopDuration;
    const pred = expStart * Math.pow(expEnd / expStart, t / Math.max(1e-6, duration));
    const d = freqs[i]! - pred;
    expMse += d * d;
  }
  expMse /= n;

  // Check for sinusoidal FM modulation if track has >= 8 frames and oscillation around mean
  let bestFm: ProceduralFrequencyLaw | null = null;
  let fmMse = Infinity;
  if (n >= 8) {
    const fftLen = nextPowerOf2(Math.max(32, n * 4));
    const fft = getCachedFFT(fftLen);
    const detrended = new Float64Array(fftLen);
    for (let i = 0; i < n; i++) {
      detrended[i] = freqs[i]! - meanFreq;
    }
    const { real, imag } = fft.forwardReal(detrended);
    const half = fftLen >> 1;
    const modRate = 1 / hopDuration;
    let bestBin = -1;
    let bestMag = 0;
    for (let k = 1; k < half; k++) {
      const fmFreq = (k * modRate) / fftLen;
      if (fmFreq < 0.8 || fmFreq > modRate * 0.42) continue;
      const m = Math.hypot(real[k]!, imag[k]!);
      if (m > bestMag) {
        bestMag = m;
        bestBin = k;
      }
    }
    if (bestBin > 0) {
      // Parabolic interpolation on modulation spectrum for sub-bin modFreq accuracy
      let delta = 0;
      if (bestBin > 1 && bestBin < half - 1) {
        const mPrev = Math.hypot(real[bestBin - 1]!, imag[bestBin - 1]!);
        const mCurr = bestMag;
        const mNext = Math.hypot(real[bestBin + 1]!, imag[bestBin + 1]!);
        const denom = mPrev - 2 * mCurr + mNext;
        if (Math.abs(denom) > 1e-12) {
          delta = Math.max(-0.5, Math.min(0.5, (0.5 * (mPrev - mNext)) / denom));
        }
      }
      const modFreq = ((bestBin + delta) * modRate) / fftLen;
      // Fit exact cos/sin amplitude at modFreq
      let ds = 0;
      let dc = 0;
      let ns = 0;
      let nc = 0;
      for (let i = 0; i < n; i++) {
        const ang = TWO_PI * modFreq * i * hopDuration;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const y = freqs[i]! - meanFreq;
        dc += y * c;
        ds += y * s;
        nc += c * c;
        ns += s * s;
      }
      const aCos = nc > 1e-6 ? dc / nc : 0;
      const aSin = ns > 1e-6 ? ds / ns : 0;
      const modDepth = Math.hypot(aCos, aSin);
      const modPhase = wrapPhase(Math.atan2(-aSin, aCos));

      if (modDepth > Math.max(4, meanFreq * 0.015)) {
        let err = 0;
        for (let i = 0; i < n; i++) {
          const pred = meanFreq + modDepth * Math.cos(TWO_PI * modFreq * i * hopDuration + modPhase);
          const d = freqs[i]! - pred;
          err += d * d;
        }
        fmMse = err / n;
        if (fmMse < constMse * 0.45 && fmMse < Math.min(linMse, expMse) * 0.65) {
          bestFm = {
            type: 'fm',
            carrierFreq: meanFreq,
            modFreq,
            modDepth,
            modPhase,
          };
        }
      }
    }
  }

  if (bestFm) return bestFm;

  // Pick best between linear and exponential (if they improve significantly over constant)
  const bestSweepMse = Math.min(linMse, expMse);
  if (bestSweepMse < constMse * 0.6) {
    if (expMse <= linMse * 1.03 && Math.abs(expEnd - expStart) > 5) {
      return { type: 'exponential', startFreq: expStart, endFreq: expEnd };
    }
    return { type: 'linear', startFreq: linStart, endFreq: linEnd };
  }

  return { type: 'constant', freq: meanFreq };
}

/**
 * Fits the best compact amplitude envelope (constant, exp-decay, attack-decay, AM, or piecewise).
 */
function fitEnvelopeLaw(amps: number[], hopDuration: number): ProceduralEnvelopeLaw {
  const n = amps.length;
  if (n <= 1) return { type: 'constant' };

  let maxAmp = 0;
  let peakIdx = 0;
  let meanAmp = 0;
  for (let i = 0; i < n; i++) {
    const a = amps[i]!;
    meanAmp += a;
    if (a > maxAmp) {
      maxAmp = a;
      peakIdx = i;
    }
  }
  meanAmp /= n;
  if (maxAmp < 1e-8) return { type: 'constant' };

  const norm = amps.map((a) => a / maxAmp);

  // Constant check
  let constMse = 0;
  const meanNorm = meanAmp / maxAmp;
  for (let i = 0; i < n; i++) {
    const d = norm[i]! - meanNorm;
    constMse += d * d;
  }
  constMse /= n;
  if (Math.sqrt(constMse) < 0.06) {
    return { type: 'constant' };
  }

  // Fit exponential decay from peakIdx onward via weighted log-linear regression
  let sumT = 0;
  let sumT2 = 0;
  let sumLn = 0;
  let sumTLn = 0;
  let wSum = 0;
  for (let i = peakIdx; i < n; i++) {
    const y = norm[i]!;
    if (y < 0.03) continue;
    const t = (i - peakIdx) * hopDuration;
    const w = y * y;
    const lny = Math.log(y);
    wSum += w;
    sumT += w * t;
    sumT2 += w * t * t;
    sumLn += w * lny;
    sumTLn += w * t * lny;
  }
  const denom = wSum * sumT2 - sumT * sumT;
  const rawSlope = Math.abs(denom) > 1e-12 ? (wSum * sumTLn - sumT * sumLn) / denom : 0;
  const decayRate = Math.max(0, Math.min(200, -rawSlope));

  // Evaluate pure exp-decay MSE
  let expMse = 0;
  for (let i = 0; i < n; i++) {
    const pred = Math.exp(-decayRate * i * hopDuration);
    const d = norm[i]! - pred;
    expMse += d * d;
  }
  expMse /= n;

  // Evaluate attack-decay if peak is not at start
  let atkDecMse = Infinity;
  let attackTime = 0.005;
  if (peakIdx >= 1) {
    attackTime = Math.max(0.002, (peakIdx * hopDuration) / 2.2);
    // Normalize peak of (1 - exp(-t/ta))*exp(-k*t)
    let predPeak = 0;
    for (let i = 0; i < n; i++) {
      const t = i * hopDuration;
      const v = (1 - Math.exp(-t / attackTime)) * Math.exp(-decayRate * t);
      if (v > predPeak) predPeak = v;
    }
    predPeak = Math.max(1e-6, predPeak);
    let err = 0;
    for (let i = 0; i < n; i++) {
      const t = i * hopDuration;
      const v = ((1 - Math.exp(-t / attackTime)) * Math.exp(-decayRate * t)) / predPeak;
      const d = norm[i]! - v;
      err += d * d;
    }
    atkDecMse = err / n;
  }

  // Evaluate AM (sinusoidal amplitude modulation) if n >= 8
  let amLaw: ProceduralEnvelopeLaw | null = null;
  let amMse = Infinity;
  if (n >= 8) {
    const detrend = new Float64Array(nextPowerOf2(n * 4));
    let meanRes = 0;
    const envRatios = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const base = Math.exp(-decayRate * i * hopDuration);
      envRatios[i] = base > 0.05 ? norm[i]! / base : 0;
      meanRes += envRatios[i]!;
    }
    meanRes /= n;
    for (let i = 0; i < n; i++) detrend[i] = envRatios[i]! - meanRes;

    const fft = getCachedFFT(detrend.length);
    const { real, imag } = fft.forwardReal(detrend);
    const half = detrend.length >> 1;
    const modRate = 1 / hopDuration;
    let bestBin = -1;
    let bestMag = 0;
    for (let k = 1; k < half; k++) {
      const fm = (k * modRate) / detrend.length;
      if (fm < 1.0 || fm > modRate * 0.42) continue;
      const m = Math.hypot(real[k]!, imag[k]!);
      if (m > bestMag) {
        bestMag = m;
        bestBin = k;
      }
    }
    if (bestBin > 0) {
      const amFreq = (bestBin * modRate) / detrend.length;
      let ds = 0;
      let dc = 0;
      let ns = 0;
      let nc = 0;
      for (let i = 0; i < n; i++) {
        const ang = TWO_PI * amFreq * i * hopDuration;
        const s = Math.sin(ang);
        const c = Math.cos(ang);
        const y = envRatios[i]! - meanRes;
        ds += y * s;
        dc += y * c;
        ns += s * s;
        nc += c * c;
      }
      const aS = ns > 1e-6 ? ds / ns : 0;
      const aC = nc > 1e-6 ? dc / nc : 0;
      const amAmp = Math.hypot(aS, aC);
      const amDepth = Math.min(1.0, amAmp / Math.max(0.1, meanRes));
      const amPhase = wrapPhase(Math.atan2(aC, aS));

      if (amDepth > 0.12) {
        let predPeak = 0;
        const preds = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const t = i * hopDuration;
          const v =
            Math.max(0, 1 + amDepth * Math.sin(TWO_PI * amFreq * t + amPhase)) *
            Math.exp(-decayRate * t);
          preds[i] = v;
          if (v > predPeak) predPeak = v;
        }
        predPeak = Math.max(1e-6, predPeak);
        let err = 0;
        for (let i = 0; i < n; i++) {
          const d = norm[i]! - preds[i]! / predPeak;
          err += d * d;
        }
        amMse = err / n;
        if (amMse < Math.min(expMse, atkDecMse, constMse) * 0.55) {
          amLaw = {
            type: 'am',
            amFreq: roundSig(amFreq, 4),
            amDepth: roundSig(amDepth, 3),
            amPhase: roundSig(amPhase, 3),
            decayRate: roundSig(decayRate, 3),
          };
        }
      }
    }
  }

  if (amLaw) return amLaw;

  const bestSimpleMse = Math.min(expMse, atkDecMse);
  if (bestSimpleMse < 0.035) {
    if (atkDecMse < expMse * 0.85 && peakIdx >= 1) {
      return {
        type: 'attack-decay',
        attackTime: roundSig(attackTime, 3),
        decayRate: roundSig(decayRate, 3),
      };
    }
    return { type: 'exp-decay', decayRate: roundSig(decayRate, 3) };
  }

  // Fallback compact 6-point piecewise linear envelope for multi-stage shapes
  const numKnots = Math.min(6, n);
  const points: [number, number][] = [];
  for (let k = 0; k < numKnots; k++) {
    const idx = Math.round((k * (n - 1)) / Math.max(1, numKnots - 1));
    points.push([roundSig(idx * hopDuration, 4), roundSig(norm[idx]!, 3)]);
  }
  return { type: 'piecewise', points };
}

/**
 * Refines a constant frequency slightly around `initialFreq` via golden-section search
 * to maximize exact projection energy on the target signal (achieves < 0.01 Hz lock!).
 */
function refineConstantFrequency(
  residual: Float64Array,
  sampleRate: number,
  startTime: number,
  duration: number,
  initialFreq: number,
  envLaw: ProceduralEnvelopeLaw,
  searchHalfWidthHz: number
): number {
  let lo = Math.max(10, initialFreq - searchHalfWidthHz);
  let hi = Math.min(sampleRate / 2 - 1, initialFreq + searchHalfWidthHz);
  const phi = (Math.sqrt(5) - 1) / 2;

  const evalEnergy = (f: number) =>
    projectOptimalAmpPhase(
      residual,
      sampleRate,
      startTime,
      duration,
      { type: 'constant', freq: f },
      envLaw,
      true
    ).capturedEnergy;

  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = evalEnergy(x1);
  let f2 = evalEnergy(x2);

  for (let iter = 0; iter < 22; iter++) {
    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = evalEnergy(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = evalEnergy(x1);
    }
  }

  return 0.5 * (lo + hi);
}

/**
 * Fits a compact analytical ProceduralMathModel directly from the uploaded audio.
 * Never substitutes unrelated presets; every frequency, amplitude, phase, envelope, and noise burst
 * is derived mathematically from the actual input waveform.
 */
export function analyzeToProceduralMath(
  channels: Float32Array[],
  sampleRate: number,
  originalSampleRate: number,
  config: ReconstructionConfig,
  name: string,
  options: { isCancelled?: () => boolean; onProgress?: (fraction: number) => void } = {}
): ProceduralMathModel {
  const numChannels = Math.max(1, channels.length);
  const length = channels[0]?.length ?? 0;
  const duration = sampleRate > 0 ? length / sampleRate : 0;

  // Global peak & DC offset
  let globalPeak = 0;
  const dcOffset: number[] = [];
  for (let c = 0; c < numChannels; c++) {
    const ch = channels[c]!;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]!;
      sum += v;
      if (Math.abs(v) > globalPeak) globalPeak = Math.abs(v);
    }
    const dc = ch.length > 0 ? sum / ch.length : 0;
    dcOffset.push(config.minFrequency <= 0 && Math.abs(dc) > 1e-4 ? roundSig(dc, 5) : 0);
  }

  if (globalPeak < SILENCE_PEAK_THRESHOLD || length === 0) {
    return {
      format: 'sin-sfx-math-v2',
      mode: 'procedural',
      representation: 'procedural-math',
      name,
      sampleRate,
      originalSampleRate,
      duration,
      length,
      channels: numChannels,
      preservePhase: config.preservePhase,
      dcOffset,
      partials: [],
      noiseBursts: [],
      stats: { partialCount: 0, noiseBurstCount: 0, isSilent: true },
    };
  }

  const compression = Math.max(0, Math.min(1, config.compressionAggressiveness));
  const maxPartialsPerChannel = Math.max(
    1,
    Math.min(16, Math.min(config.maxOscillators, Math.round(12 - compression * 8)))
  );
  const sigDigits = Math.max(3, Math.round(6 - compression * 2.5));

  // Extract sinusoidal tracks first to discover time-varying components
  const trackModel = analyzeToSinusoidalTracks(
    channels,
    sampleRate,
    originalSampleRate,
    {
      ...config,
      maxOscillators: Math.min(24, Math.max(8, config.maxOscillators)),
      compressionAggressiveness: Math.min(0.4, compression),
      preservePhase: true,
    },
    name,
    { isCancelled: options.isCancelled }
  );

  const hopDuration = trackModel.hopSize / sampleRate;
  const partials: ProceduralPartial[] = [];
  const noiseBursts: ProceduralNoiseBurst[] = [];

  for (let c = 0; c < numChannels; c++) {
    if (options.isCancelled?.()) throw new Error('CANCELLED');

    const ch = channels[c]!;
    const residual = new Float64Array(length);
    const dc = dcOffset[c]!;
    let origEnergy = 0;
    for (let i = 0; i < length; i++) {
      const v = ch[i]! - dc;
      residual[i] = v;
      origEnergy += v * v;
    }

    const tracks = trackModel.channelTracks[c] ?? [];
    // Rank tracks by integrated squared amplitude (total partial energy)
    const ranked = tracks
      .map((tr) => {
        let energy = 0;
        for (const p of tr.points) energy += p[1] * p[1];
        return { tr, energy };
      })
      .sort((a, b) => b.energy - a.energy);

    const energyStop = origEnergy * Math.max(0.5, Math.min(0.995, config.targetQuality));
    let totalCaptured = 0;
    let partialIdx = 0;

    for (const item of ranked) {
      if (partialIdx >= maxPartialsPerChannel) break;
      if (totalCaptured >= energyStop) break;
      if (options.isCancelled?.()) throw new Error('CANCELLED');

      const tr = item.tr;
      const freqs = tr.points.map((p) => p[0]);
      const amps = tr.points.map((p) => p[1]);

      const startTime = Math.max(0, tr.startFrame * hopDuration);
      const endTime = Math.min(
        duration,
        (tr.startFrame + Math.max(1, tr.points.length)) * hopDuration
      );
      const partDur = Math.max(1 / sampleRate, endTime - startTime);

      let freqLaw = fitFrequencyLaw(freqs, amps, hopDuration, partDur);
      const envLaw = fitEnvelopeLaw(amps, hopDuration);

      // Micro-refine constant frequencies against exact residual for crisp sub-0.01 Hz lock
      if (freqLaw.type === 'constant' && length <= 200000) {
        const refinedF = refineConstantFrequency(
          residual,
          sampleRate,
          startTime,
          partDur,
          freqLaw.freq,
          envLaw,
          Math.max(1.5, (sampleRate / trackModel.fftSize) * 0.6)
        );
        freqLaw = { type: 'constant', freq: roundSig(refinedF, Math.max(6, sigDigits + 2)) };
      } else if (freqLaw.type === 'linear') {
        freqLaw = {
          type: 'linear',
          startFreq: roundSig(freqLaw.startFreq, sigDigits),
          endFreq: roundSig(freqLaw.endFreq, sigDigits),
        };
      } else if (freqLaw.type === 'exponential') {
        freqLaw = {
          type: 'exponential',
          startFreq: roundSig(freqLaw.startFreq, sigDigits),
          endFreq: roundSig(freqLaw.endFreq, sigDigits),
        };
      } else if (freqLaw.type === 'fm') {
        freqLaw = {
          type: 'fm',
          carrierFreq: roundSig(freqLaw.carrierFreq, sigDigits + 1),
          modFreq: roundSig(freqLaw.modFreq, sigDigits),
          modDepth: roundSig(freqLaw.modDepth, sigDigits),
          modPhase: roundSig(freqLaw.modPhase, sigDigits),
        };
      }

      let proj = projectOptimalAmpPhase(
        residual,
        sampleRate,
        startTime,
        partDur,
        freqLaw,
        envLaw,
        config.preservePhase
      );

      // If non-constant law (e.g. FM/sweep) has low phase-coherent projection energy, also try
      // phase-unaligned amplitude estimate from the track's own measured RMS so audible FM/sweep
      // partials are never dropped to zero in procedural approximation mode.
      if (freqLaw.type !== 'constant' && proj.capturedEnergy < origEnergy * 0.05) {
        const trackMeanAmp = amps.reduce((a, b) => a + b, 0) / Math.max(1, amps.length);
        if (trackMeanAmp > proj.amplitude) {
          proj = {
            amplitude: trackMeanAmp,
            phase: tr.points[0]?.[2] ?? 0,
            capturedEnergy: trackMeanAmp * trackMeanAmp * (partDur * sampleRate * 0.25),
          };
        }
      }

      // Only accept partial if it genuinely reduces residual error above threshold
      const minAmp = globalPeak * Math.pow(10, config.minAmplitudeDb / 20);
      if (proj.amplitude < minAmp || proj.capturedEnergy < origEnergy * 1e-4) {
        continue;
      }

      const partial: ProceduralPartial = {
        id: `p-${c}-${partialIdx + 1}`,
        channel: c,
        startTime: roundSig(startTime, 4),
        duration: roundSig(partDur, 4),
        amplitude: roundSig(proj.amplitude, sigDigits),
        phase: config.preservePhase ? roundSig(proj.phase, sigDigits) : 0,
        frequency: freqLaw,
        envelope: envLaw,
      };
      partials.push(partial);

      // Subtract fitted partial from residual (Orthogonal Matching Pursuit step)
      const s0 = Math.max(0, Math.floor(partial.startTime * sampleRate));
      const s1 = Math.min(length, Math.ceil((partial.startTime + partial.duration) * sampleRate));
      for (let i = s0; i < s1; i++) {
        const tau = i / sampleRate - partial.startTime;
        const val =
          partial.amplitude *
          evalEnvelopeLaw(partial.envelope, tau) *
          Math.sin(evalFrequencyPhase(partial.frequency, tau, partial.duration) + partial.phase);
        residual[i] = residual[i]! - val;
      }

      totalCaptured += proj.capturedEnergy;
      partialIdx++;
    }

    // Check residual broadband / transient energy -> optional compact deterministic noise burst
    let resEnergy = 0;
    for (let i = 0; i < length; i++) resEnergy += residual[i]! * residual[i]!;
    const resRatio = origEnergy > 1e-12 ? resEnergy / origEnergy : 0;

    if (resRatio > 0.18 && (config.enableResidualNoise || partials.length === 0)) {
      const resFloat32 = Float32Array.from(residual);
      const resAnalysis = analyzeAudioSamples([resFloat32], sampleRate);
      if (!resAnalysis.isSilent) {
        const centroid = Math.max(150, Math.min(sampleRate * 0.42, resAnalysis.averageSpectralCentroid || 1500));
        const lowCutHz = Math.max(30, Math.min(centroid * 0.35, config.maxFrequency * 0.5));
        const highCutHz = Math.max(lowCutHz + 200, Math.min(sampleRate * 0.45, centroid * 2.2, config.maxFrequency));
        const rmsScale = Math.min(1.0, resAnalysis.rmsLoudness * 2.4);
        const decayRate = Math.max(0.5, Math.min(120, 2.3 / Math.max(0.015, resAnalysis.decayDuration)));

        noiseBursts.push({
          id: `n-${c}-1`,
          channel: c,
          startTime: 0,
          duration: roundSig(duration, 4),
          amplitude: roundSig(rmsScale, 3),
          seed: 4201 + c * 997,
          lowCutHz: Math.round(lowCutHz),
          highCutHz: Math.round(highCutHz),
          attackTime: roundSig(Math.max(0.0005, resAnalysis.attackDuration), 4),
          decayRate: roundSig(decayRate, 3),
        });
      }
    }

    if (options.onProgress) {
      options.onProgress((c + 1) / numChannels);
    }
  }

  return {
    format: 'sin-sfx-math-v2',
    mode: 'procedural',
    representation: 'procedural-math',
    name,
    sampleRate,
    originalSampleRate,
    duration,
    length,
    channels: numChannels,
    preservePhase: config.preservePhase,
    dcOffset,
    partials,
    noiseBursts,
    stats: {
      partialCount: partials.length,
      noiseBurstCount: noiseBursts.length,
      isSilent: false,
    },
  };
}

/**
 * Evaluates a single sample of the tonal (sinusoidal) part of a ProceduralMathModel at time t.
 */
export function evaluateProceduralSample(
  model: ProceduralMathModel,
  t: number,
  channel = 0
): number {
  if (t < 0 || t >= model.duration) return 0;
  let sum = model.dcOffset[channel] ?? 0;

  for (const p of model.partials) {
    if (p.channel !== -1 && p.channel !== channel) continue;
    const tau = t - p.startTime;
    if (tau < 0 || tau > p.duration) continue;
    const env = evalEnvelopeLaw(p.envelope, tau);
    const theta = evalFrequencyPhase(p.frequency, tau, p.duration);
    sum += p.amplitude * env * Math.sin(theta + p.phase);
  }
  return sum;
}

/**
 * Reconstructs full audio channels exclusively from a ProceduralMathModel.
 * Deterministic across JS, TS, C, C++, and Python exports.
 */
export function reconstructFromProceduralMath(model: ProceduralMathModel): Float32Array[] {
  const { length, channels, sampleRate, dcOffset, partials, noiseBursts } = model;
  const outputs: Float32Array[] = [];

  for (let c = 0; c < channels; c++) {
    const out64 = new Float64Array(length);
    const dc = dcOffset[c] ?? 0;
    if (dc !== 0) out64.fill(dc);

    for (const p of partials) {
      if (p.channel !== -1 && p.channel !== c) continue;
      const s0 = Math.max(0, Math.floor(p.startTime * sampleRate));
      const s1 = Math.min(length, Math.ceil((p.startTime + p.duration) * sampleRate));
      for (let i = s0; i < s1; i++) {
        const tau = i / sampleRate - p.startTime;
        const env = evalEnvelopeLaw(p.envelope, tau);
        const theta = evalFrequencyPhase(p.frequency, tau, p.duration);
        out64[i] = out64[i]! + p.amplitude * env * Math.sin(theta + p.phase);
      }
    }

    // Deterministic 1-pole bandpass-filtered Mulberry32 PRNG noise bursts
    for (const nb of noiseBursts) {
      if (nb.channel !== -1 && nb.channel !== c) continue;
      const rng = createSeededRandom(nb.seed);
      const s0 = Math.max(0, Math.floor(nb.startTime * sampleRate));
      const s1 = Math.min(length, Math.ceil((nb.startTime + nb.duration) * sampleRate));

      const dt = 1 / sampleRate;
      const rcLp = 1 / (TWO_PI * Math.max(20, nb.highCutHz));
      const alphaLp = dt / (rcLp + dt);
      const rcHp = 1 / (TWO_PI * Math.max(10, nb.lowCutHz));
      const alphaHp = rcHp / (rcHp + dt);

      let lpState = 0;
      let hpState = 0;
      let prevLp = 0;

      for (let i = s0; i < s1; i++) {
        const tau = i / sampleRate - nb.startTime;
        const white = rng() * 2 - 1;
        lpState = lpState + alphaLp * (white - lpState);
        hpState = alphaHp * (hpState + lpState - prevLp);
        prevLp = lpState;

        const env =
          (1 - Math.exp(-tau / Math.max(1e-4, nb.attackTime))) * Math.exp(-nb.decayRate * tau);
        out64[i] = out64[i]! + nb.amplitude * env * hpState;
      }
    }

    const out32 = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      out32[i] = out64[i]!;
    }
    outputs.push(out32);
  }

  return outputs;
}

/**
 * Converts a ProceduralMathModel into an editable SoundRecipe for the manual Procedural Layer Editor.
 */
export function proceduralModelToSoundRecipe(
  model: ProceduralMathModel,
  originalFileName?: string,
  originalSizeBytes?: number
): SoundRecipe {
  const layers: SoundLayer[] = [];

  for (const p of model.partials) {
    let startFreq = 440;
    let endFreq = 440;
    let frequencyCurve: 'constant' | 'linear' | 'exponential' = 'constant';
    let fmEnabled = false;
    let fmFreq = 60;
    let fmDepth = 0;

    if (p.frequency.type === 'constant') {
      startFreq = p.frequency.freq;
      endFreq = p.frequency.freq;
    } else if (p.frequency.type === 'linear') {
      startFreq = p.frequency.startFreq;
      endFreq = p.frequency.endFreq;
      frequencyCurve = 'linear';
    } else if (p.frequency.type === 'exponential') {
      startFreq = p.frequency.startFreq;
      endFreq = p.frequency.endFreq;
      frequencyCurve = 'exponential';
    } else if (p.frequency.type === 'fm') {
      startFreq = p.frequency.carrierFreq;
      endFreq = p.frequency.carrierFreq;
      fmEnabled = true;
      fmFreq = p.frequency.modFreq;
      fmDepth = p.frequency.modDepth;
    }

    let attack = 0.002;
    let decay = Math.max(0.01, p.duration * 0.7);
    let sustain = 0.05;
    if (p.envelope.type === 'constant') {
      sustain = 1.0;
      decay = 0.01;
    } else if (p.envelope.type === 'exp-decay') {
      decay = Math.min(p.duration, 2.3 / Math.max(0.5, p.envelope.decayRate));
      sustain = 0.0;
    } else if (p.envelope.type === 'attack-decay') {
      attack = Math.max(0.001, p.envelope.attackTime);
      decay = Math.min(p.duration, 2.3 / Math.max(0.5, p.envelope.decayRate));
      sustain = 0.0;
    }

    const pan = model.channels === 2 ? (p.channel === 0 ? -0.7 : 0.7) : 0;

    layers.push({
      id: p.id,
      name: `Sine ${Math.round(startFreq)} Hz`,
      enabled: true,
      solo: false,
      oscillatorType: 'sine',
      startTime: p.startTime,
      duration: Math.max(0.01, p.duration),
      gain: Math.max(0, Math.min(1.2, p.amplitude)),
      pan,
      startFrequency: Math.max(20, Math.min(20000, startFreq)),
      endFrequency: Math.max(20, Math.min(20000, endFreq)),
      frequencyCurve,
      envelope: {
        attack,
        decay,
        sustain,
        release: Math.min(0.05, p.duration * 0.15),
      },
      lowPassFilter: { enabled: false, cutoff: 12000, q: 1 },
      highPassFilter: { enabled: false, cutoff: 30, q: 0.7 },
      distortion: { enabled: false, amount: 0 },
      delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
      frequencyModulation: { enabled: fmEnabled, modFrequency: fmFreq, modDepth: fmDepth },
      seed: 100 + layers.length,
    });
  }

  for (const nb of model.noiseBursts) {
    const pan = model.channels === 2 ? (nb.channel === 0 ? -0.7 : 0.7) : 0;
    layers.push({
      id: nb.id,
      name: `Filtered Noise (${nb.lowCutHz}-${nb.highCutHz} Hz)`,
      enabled: true,
      solo: false,
      oscillatorType: 'noise',
      startTime: nb.startTime,
      duration: Math.max(0.01, nb.duration),
      gain: Math.max(0, Math.min(1.0, nb.amplitude)),
      pan,
      startFrequency: nb.highCutHz,
      endFrequency: nb.highCutHz,
      frequencyCurve: 'constant',
      envelope: {
        attack: Math.max(0.001, nb.attackTime),
        decay: Math.min(nb.duration, 2.3 / Math.max(0.5, nb.decayRate)),
        sustain: 0.0,
        release: Math.min(0.04, nb.duration * 0.15),
      },
      lowPassFilter: { enabled: true, cutoff: nb.highCutHz, q: 1.0 },
      highPassFilter: { enabled: true, cutoff: nb.lowCutHz, q: 0.8 },
      distortion: { enabled: false, amount: 0 },
      delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
      frequencyModulation: { enabled: false, modFrequency: 60, modDepth: 0 },
      seed: nb.seed,
    });
  }

  return {
    version: 1,
    name: model.name || 'Procedural Math Approximation',
    category: 'Procedural',
    duration: Math.max(0.02, model.duration),
    masterGain: 1.0,
    layers,
    metadata: {
      originalFileName,
      originalDuration: model.duration,
      originalSizeBytes,
      createdAt: new Date().toISOString(),
      generator: 'Resonance SFX Analytical Procedural Fitter',
    },
  };
}
