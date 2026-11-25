import {
  MathConversionResult,
  MathSoundModel,
  ReconstructionConfig,
} from '@/types/mathModel';
import { analyzeAudioSamples } from '@/audio/analysis/analyzer';
import { resampleChannels } from '@/audio/analysis/resampler';
import { compareAudioSignals } from '@/audio/comparison/comparator';
import { analyzeToStftSinusoids, reconstructFromStftSinusoids } from './stftEngine';
import {
  analyzeToSinusoidalTracks,
  reconstructFromSinusoidalTracks,
} from './sinusoidalTracksEngine';
import {
  addResidualNoiseToChannels,
  extractResidualNoiseModel,
} from './residualNoise';
import {
  analyzeToProceduralMath,
  reconstructFromProceduralMath,
} from './proceduralEngine';

/**
 * Reconstructs PCM channels exclusively from a MathSoundModel.
 * Never accesses or depends on the original uploaded audio file or PCM buffers.
 */
export function reconstructFromMathModel(model: MathSoundModel): Float32Array[] {
  let channels: Float32Array[];

  switch (model.representation) {
    case 'stft-sinusoids':
      channels = reconstructFromStftSinusoids(model);
      addResidualNoiseToChannels(channels, model.residualNoise, model.sampleRate);
      return channels;

    case 'sinusoidal-tracks':
      channels = reconstructFromSinusoidalTracks(model);
      addResidualNoiseToChannels(channels, model.residualNoise, model.sampleRate);
      return channels;

    case 'procedural-math':
      return reconstructFromProceduralMath(model);
  }
}

/**
 * Full deterministic Audio-to-Math conversion + exclusive reconstruction + real metric comparison.
 * Runs identically in Web Workers, browsers, and Node.js test environments.
 */
export function convertAudioToMath(
  originalChannels: Float32Array[],
  originalSampleRate: number,
  config: ReconstructionConfig,
  options: {
    name?: string;
    isCancelled?: () => boolean;
    onProgress?: (progress: number, stage: string) => void;
  } = {}
): MathConversionResult {
  const tStart = performance.now();
  const name = options.name || 'Converted Sound';
  const targetSampleRate =
    config.outputSampleRate === 'original' ? originalSampleRate : config.outputSampleRate;

  options.onProgress?.(0.05, 'Preparing audio signal & sample rate...');

  const workingChannels =
    targetSampleRate === originalSampleRate
      ? originalChannels
      : resampleChannels(originalChannels, originalSampleRate, targetSampleRate);

  const tAnalysisStart = performance.now();
  const analysis = analyzeAudioSamples(workingChannels, targetSampleRate);
  const analysisMs = performance.now() - tAnalysisStart;

  if (options.isCancelled?.()) throw new Error('CANCELLED');

  const tConvStart = performance.now();
  let model: MathSoundModel;

  if (config.mode === 'exact') {
    options.onProgress?.(0.2, 'Extracting exact Fourier STFT coefficients...');
    model = analyzeToStftSinusoids(
      workingChannels,
      targetSampleRate,
      originalSampleRate,
      config,
      name,
      {
        mode: 'exact',
        isCancelled: options.isCancelled,
        onProgress: (f) => options.onProgress?.(0.2 + f * 0.45, 'Computing Exact STFT frames...'),
      }
    );
  } else if (config.mode === 'optimized') {
    // Auto-select between McAulay-Quatieri Sinusoidal Tracks (best for tonal/harmonic/sweeps/AM/FM)
    // and Sparse STFT Sinusoids (best for sharp impulses, explosions, footsteps, broadband noise).
    let useTracks = config.optimizedMethod === 'sinusoidal-tracks';
    if (config.optimizedMethod === 'auto') {
      const isBroadbandOrImpulse =
        analysis.classification === 'noisy' ||
        analysis.crestFactor > 7.0 ||
        analysis.tonalVsNoisyScore < 0.45 ||
        workingChannels[0]!.length < Math.min(config.windowSize, 512);
      useTracks = !isBroadbandOrImpulse;
    }

    if (useTracks) {
      options.onProgress?.(0.2, 'Tracking continuous sinusoidal partials (McAulay-Quatieri)...');
      const trackModel = analyzeToSinusoidalTracks(
        workingChannels,
        targetSampleRate,
        originalSampleRate,
        config,
        name,
        {
          isCancelled: options.isCancelled,
          onProgress: (f) =>
            options.onProgress?.(0.2 + f * 0.4, 'Tracking sinusoidal peaks & phases...'),
        }
      );

      if (config.enableResidualNoise && !trackModel.stats.isSilent) {
        options.onProgress?.(0.62, 'Modeling deterministic residual noise bands...');
        const prelimRecon = reconstructFromSinusoidalTracks(trackModel);
        trackModel.residualNoise = extractResidualNoiseModel(
          workingChannels,
          prelimRecon,
          targetSampleRate,
          trackModel.hopSize,
          config.compressionAggressiveness
        );
      }
      model = trackModel;
    } else {
      options.onProgress?.(0.2, 'Pruning sparse STFT sinusoidal components...');
      const stftModel = analyzeToStftSinusoids(
        workingChannels,
        targetSampleRate,
        originalSampleRate,
        config,
        name,
        {
          mode: 'optimized',
          isCancelled: options.isCancelled,
          onProgress: (f) =>
            options.onProgress?.(0.2 + f * 0.4, 'Optimizing sparse STFT sinusoids...'),
        }
      );

      if (config.enableResidualNoise && !stftModel.stats.isSilent) {
        options.onProgress?.(0.62, 'Modeling deterministic residual noise bands...');
        const prelimRecon = reconstructFromStftSinusoids(stftModel);
        stftModel.residualNoise = extractResidualNoiseModel(
          workingChannels,
          prelimRecon,
          targetSampleRate,
          stftModel.hopSize,
          config.compressionAggressiveness
        );
      }
      model = stftModel;
    }
  } else {
    options.onProgress?.(0.2, 'Fitting closed-form analytical mathematical functions...');
    model = analyzeToProceduralMath(
      workingChannels,
      targetSampleRate,
      originalSampleRate,
      config,
      name,
      {
        isCancelled: options.isCancelled,
        onProgress: (f) =>
          options.onProgress?.(0.2 + f * 0.45, 'Fitting analytical sine & envelope equations...'),
      }
    );
  }

  const conversionMs = performance.now() - tConvStart;
  if (options.isCancelled?.()) throw new Error('CANCELLED');

  // Reconstruct EXCLUSIVELY from the mathematical model
  options.onProgress?.(0.7, 'Reconstructing audio exclusively from mathematical representation...');
  const tReconStart = performance.now();
  const reconstructedChannels = reconstructFromMathModel(model);
  const reconstructionMs = performance.now() - tReconStart;

  if (options.isCancelled?.()) throw new Error('CANCELLED');

  // Measure true sample-by-sample error against original (aligned at targetSampleRate)
  options.onProgress?.(0.86, 'Computing SNR, RMSE, Log-Spectral Distance & spectrograms...');
  const tCompStart = performance.now();
  const { metrics, differenceChannels } = compareAudioSignals(
    workingChannels,
    reconstructedChannels,
    targetSampleRate
  );
  const comparisonMs = performance.now() - tCompStart;
  const totalMs = performance.now() - tStart;

  options.onProgress?.(1.0, 'Complete');

  return {
    model,
    reconstructedChannels,
    differenceChannels,
    sampleRate: targetSampleRate,
    metrics,
    timings: {
      analysisMs,
      conversionMs,
      reconstructionMs,
      comparisonMs,
      totalMs,
    },
  };
}

/**
 * Formats a clear human-readable mathematical expression of the extracted sound representation
 * S(t) = Σ A[n] * sin(2π * f[n] * t + φ[n]).
 */
export function formatMathEquationSummary(model: MathSoundModel, maxTerms = 16): {
  headerFormula: string;
  terms: string[];
  totalTermCount: number;
  notes: string;
} {
  if (model.representation === 'procedural-math') {
    if (model.stats.isSilent || (model.partials.length === 0 && model.noiseBursts.length === 0)) {
      return {
        headerFormula: 'S(t) = 0',
        terms: ['0 (silent signal)'],
        totalTermCount: 0,
        notes: 'Closed-form analytical approximation.',
      };
    }

    const terms: string[] = [];
    for (const p of model.partials.slice(0, maxTerms)) {
      const chTag = model.channels > 1 ? `[ch${p.channel}] ` : '';
      let freqExpr = '';
      if (p.frequency.type === 'constant') {
        freqExpr = `2π·${p.frequency.freq}·t`;
      } else if (p.frequency.type === 'linear') {
        freqExpr = `∫2π·lin(${p.frequency.startFreq}→${p.frequency.endFreq} Hz)dt`;
      } else if (p.frequency.type === 'exponential') {
        freqExpr = `∫2π·exp(${p.frequency.startFreq}→${p.frequency.endFreq} Hz)dt`;
      } else {
        freqExpr = `2π·${p.frequency.carrierFreq}·t + ${(p.frequency.modDepth / Math.max(0.1, p.frequency.modFreq)).toFixed(2)}·sin(2π·${p.frequency.modFreq}·t)`;
      }

      const phaseStr = p.phase >= 0 ? ` + ${p.phase.toFixed(3)}` : ` - ${Math.abs(p.phase).toFixed(3)}`;
      let envExpr = '';
      if (p.envelope.type === 'exp-decay') {
        envExpr = ` · exp(-${p.envelope.decayRate}·τ)`;
      } else if (p.envelope.type === 'attack-decay') {
        envExpr = ` · (1 - exp(-τ/${p.envelope.attackTime}))·exp(-${p.envelope.decayRate}·τ)`;
      } else if (p.envelope.type === 'am') {
        envExpr = ` · (1 + ${p.envelope.amDepth}·sin(2π·${p.envelope.amFreq}·τ))·exp(-${p.envelope.decayRate}·τ)`;
      } else if (p.envelope.type === 'piecewise') {
        envExpr = ` · env_pw(τ)`;
      }

      const timeSpan =
        p.startTime > 0.001 || p.duration < model.duration - 0.005
          ? `  [t ∈ ${p.startTime.toFixed(3)}..${(p.startTime + p.duration).toFixed(3)}s]`
          : '';
      terms.push(`${chTag}${p.amplitude} · sin(${freqExpr}${phaseStr})${envExpr}${timeSpan}`);
    }

    for (const nb of model.noiseBursts) {
      terms.push(
        `+ ${nb.amplitude} · BP_${nb.lowCutHz}-${nb.highCutHz}Hz(PRNG(${nb.seed})) · exp(-${nb.decayRate}·τ)`
      );
    }

    return {
      headerFormula: 'S(t) = dc + Σ A[n] · env[n](τ) · sin(θ[n](τ) + φ[n])',
      terms,
      totalTermCount: model.partials.length + model.noiseBursts.length,
      notes:
        'Analytical procedural approximation derived via orthogonal projection onto sinusoidal & envelope bases.',
    };
  }

  if (model.representation === 'sinusoidal-tracks') {
    const allTracks = model.channelTracks.flatMap((tracks, ch) =>
      tracks.map((tr) => ({
        ch,
        tr,
        peakAmp: tr.points.reduce((m, p) => Math.max(m, p[1]), 0),
      }))
    );
    allTracks.sort((a, b) => b.peakAmp - a.peakAmp);

    const hopSec = model.hopSize / model.sampleRate;
    const terms = allTracks.slice(0, maxTerms).map(({ ch, tr }) => {
      const f0 = tr.points[0]![0];
      const f1 = tr.points[tr.points.length - 1]![0];
      const aMax = tr.points.reduce((m, p) => Math.max(m, p[1]), 0);
      const phi0 = tr.points[0]![2];
      const t0 = (tr.startFrame * hopSec).toFixed(3);
      const t1 = ((tr.startFrame + tr.points.length) * hopSec).toFixed(3);
      const chTag = model.channels > 1 ? `[ch${ch}] ` : '';
      const freqLabel = Math.abs(f1 - f0) > 5 ? `${f0.toFixed(1)}→${f1.toFixed(1)} Hz` : `${f0.toFixed(2)} Hz`;
      return `${chTag}A_max=${aMax.toFixed(4)} · sin(ψ(t); f=${freqLabel}, φ₀=${phi0.toFixed(3)})  [${t0}s..${t1}s, ${tr.points.length} frames]`;
    });

    return {
      headerFormula:
        'S(t) = dc + Σ_k A_k(t) · sin(ψ_k(t))  [McAulay-Quatieri cubic phase interpolation]',
      terms,
      totalTermCount: allTracks.length,
      notes: `${model.stats.totalTracks} continuous tracks across ${model.numFrames} frames (hop ${model.hopSize} samples, phase ${model.preservePhase ? 'preserved' : 'unaligned'}).`,
    };
  }

  // STFT Sinusoids (Exact or Optimized Sparse)
  const binRes = model.sampleRate / model.fftSize;
  // Summarize peak frame sinusoids
  let peakFrame = model.channelFrames[0]?.[0];
  let bestScore = -1;
  for (const frame of model.channelFrames[0] ?? []) {
    let score = 0;
    for (let i = 1; i < frame.bins.length; i += 3) score += frame.bins[i]! * frame.bins[i]!;
    if (score > bestScore) {
      bestScore = score;
      peakFrame = frame;
    }
  }

  const peakEntries: { k: number; amp: number; phase: number }[] = [];
  if (peakFrame) {
    for (let i = 0; i + 2 < peakFrame.bins.length; i += 3) {
      peakEntries.push({
        k: peakFrame.bins[i]!,
        amp: peakFrame.bins[i + 1]!,
        phase: peakFrame.bins[i + 2]!,
      });
    }
    peakEntries.sort((a, b) => b.amp - a.amp);
  }

  const terms = peakEntries.slice(0, maxTerms).map((e) => {
    const f = e.k * binRes;
    const sign = e.phase >= 0 ? '+' : '-';
    return `${e.amp.toExponential(3)} · sin(2π · ${f.toFixed(2)} · τ ${sign} ${Math.abs(e.phase).toFixed(3)})  [bin ${e.k}]`;
  });

  return {
    headerFormula:
      'S(t) = (1/COLA) · Σ_m w_s(t - t_m) · [dc_m + Σ_k A[m,k] · sin(2π·f[k]·(t - t_m) + φ[m,k])]',
    terms,
    totalTermCount: model.stats.totalSinusoids,
    notes: `${model.mode === 'exact' ? 'Exact' : 'Sparse Optimized'} STFT (${model.fftSize}-pt FFT, ${model.windowSize}-pt ${model.windowType} window, hop ${model.hopSize}): ${model.stats.totalSinusoids.toLocaleString()} total sinusoidal components across ${model.stats.totalFrames} channel-frames (showing peak frame top terms).`,
  };
}
