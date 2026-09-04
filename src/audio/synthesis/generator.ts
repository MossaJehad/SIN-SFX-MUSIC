import { SoundLayer, SoundRecipe } from '@/types/recipe';
import { AudioAnalysisResult } from '@/types/analysis';
import { PresetKey } from '@/config/appConfig';

/**
 * Deterministically generates an initial procedural recipe from audio analysis features.
 */
export function generateRecipeFromAnalysis(
  analysis: AudioAnalysisResult,
  preset: PresetKey = 'balanced',
  originalFileName = 'Recorded Audio',
  originalSizeBytes = 0
): SoundRecipe {
  const duration = Math.max(0.04, Math.min(3.0, analysis.duration));
  const classification = analysis.classification;
  const layers: SoundLayer[] = [];

  const startF = Math.max(40, Math.min(8000, analysis.startFrequencyEstimate));
  const endF = Math.max(40, Math.min(8000, analysis.endFrequencyEstimate));
  const freqRatio = endF / startF;
  const isSweep = freqRatio > 1.2 || freqRatio < 0.8;
  const freqCurve = isSweep ? 'exponential' : 'constant';

  // Base envelope from analysis
  const attack = Math.min(analysis.attackDuration, duration * 0.35);
  const decay = Math.min(analysis.decayDuration, duration * 0.65);
  const sustain = classification === 'percussive' ? 0.0 : Math.min(0.4, analysis.rmsLoudness * 1.5);
  const release = Math.max(0.01, duration * 0.2);

  if (classification === 'tonal') {
    // Primary tonal oscillator (sine or triangle)
    layers.push({
      id: 'tonal-core',
      name: 'Tonal Fundamental',
      enabled: true,
      solo: false,
      oscillatorType: 'sine',
      startTime: 0,
      duration,
      gain: 0.8,
      pan: 0,
      startFrequency: startF,
      endFrequency: endF,
      frequencyCurve: freqCurve,
      envelope: { attack, decay, sustain, release },
      lowPassFilter: {
        enabled: analysis.averageSpectralCentroid < 4000,
        cutoff: Math.max(400, Math.min(12000, analysis.averageSpectralCentroid * 1.6)),
        q: 1.0,
      },
      highPassFilter: { enabled: false, cutoff: 40, q: 0.7 },
      distortion: { enabled: false, amount: 0 },
      delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
      frequencyModulation: { enabled: false, modFrequency: 60, modDepth: 0 },
      seed: 101,
    });

    // Secondary overtone layer for balanced & accurate presets
    if (preset !== 'tiny') {
      const harmonicFreq = Math.min(16000, startF * 2);
      layers.push({
        id: 'tonal-harmonic',
        name: 'Harmonic Texture',
        enabled: true,
        solo: false,
        oscillatorType: 'triangle',
        startTime: 0,
        duration: duration * 0.9,
        gain: 0.35,
        pan: 0.15,
        startFrequency: harmonicFreq,
        endFrequency: endF * 2 > 16000 ? harmonicFreq : endF * 2,
        frequencyCurve: freqCurve,
        envelope: { attack: attack * 1.2, decay: decay * 0.8, sustain: sustain * 0.5, release },
        lowPassFilter: { enabled: true, cutoff: 8000, q: 1.5 },
        highPassFilter: { enabled: true, cutoff: 300, q: 0.7 },
        distortion: { enabled: false, amount: 0 },
        delay: { enabled: preset === 'accurate', time: 0.06, feedback: 0.2, mix: 0.15 },
        frequencyModulation: { enabled: false, modFrequency: 80, modDepth: 0 },
        seed: 102,
      });
    }

    if (preset === 'accurate') {
      // Subtle transient click or sub layer
      layers.push({
        id: 'tonal-spark',
        name: 'Transient Sparkle',
        enabled: true,
        solo: false,
        oscillatorType: 'sawtooth',
        startTime: 0,
        duration: Math.min(0.08, duration * 0.4),
        gain: 0.25,
        pan: -0.15,
        startFrequency: startF * 3 > 14000 ? startF : startF * 3,
        endFrequency: startF,
        frequencyCurve: 'exponential',
        envelope: { attack: 0.002, decay: 0.04, sustain: 0.0, release: 0.02 },
        lowPassFilter: { enabled: true, cutoff: 6000, q: 2.0 },
        highPassFilter: { enabled: true, cutoff: 800, q: 1.0 },
        distortion: { enabled: true, amount: 0.1 },
        delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
        frequencyModulation: { enabled: false, modFrequency: 120, modDepth: 0 },
        seed: 103,
      });
    }
  } else if (classification === 'noisy') {
    // Primary filtered noise layer
    layers.push({
      id: 'noise-body',
      name: 'Noise Body',
      enabled: true,
      solo: false,
      oscillatorType: 'noise',
      startTime: 0,
      duration,
      gain: 0.85,
      pan: 0,
      startFrequency: 1000,
      endFrequency: 1000,
      frequencyCurve: 'constant',
      envelope: { attack, decay, sustain, release },
      lowPassFilter: {
        enabled: true,
        cutoff: Math.max(600, Math.min(16000, analysis.averageSpectralCentroid * 1.8)),
        q: 1.8,
      },
      highPassFilter: {
        enabled: true,
        cutoff: Math.max(30, Math.min(1200, analysis.averageSpectralCentroid * 0.2)),
        q: 0.8,
      },
      distortion: { enabled: preset !== 'tiny', amount: 0.2 },
      delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
      frequencyModulation: { enabled: false, modFrequency: 60, modDepth: 0 },
      seed: 201,
    });

    if (preset !== 'tiny') {
      // Sub rumble or impact tail
      layers.push({
        id: 'noise-sub',
        name: 'Low Frequency Rumble',
        enabled: true,
        solo: false,
        oscillatorType: 'triangle',
        startTime: 0,
        duration: duration * 0.8,
        gain: 0.6,
        pan: 0,
        startFrequency: 160,
        endFrequency: 45,
        frequencyCurve: 'exponential',
        envelope: { attack: 0.003, decay: duration * 0.5, sustain: 0.05, release: 0.05 },
        lowPassFilter: { enabled: true, cutoff: 450, q: 2.0 },
        highPassFilter: { enabled: false, cutoff: 30, q: 0.7 },
        distortion: { enabled: true, amount: 0.3 },
        delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
        frequencyModulation: { enabled: false, modFrequency: 40, modDepth: 0 },
        seed: 202,
      });
    }
  } else if (classification === 'percussive') {
    // Fast pitch punch transient
    layers.push({
      id: 'percussion-punch',
      name: 'Pitch Punch',
      enabled: true,
      solo: false,
      oscillatorType: 'triangle',
      startTime: 0,
      duration: Math.min(duration, 0.25),
      gain: 0.85,
      pan: 0,
      startFrequency: Math.max(220, startF * 1.5),
      endFrequency: Math.max(40, startF * 0.25),
      frequencyCurve: 'exponential',
      envelope: { attack: 0.001, decay: Math.min(0.12, decay), sustain: 0.0, release: 0.04 },
      lowPassFilter: { enabled: true, cutoff: 2500, q: 1.5 },
      highPassFilter: { enabled: false, cutoff: 30, q: 0.7 },
      distortion: { enabled: preset !== 'tiny', amount: 0.2 },
      delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
      frequencyModulation: { enabled: false, modFrequency: 80, modDepth: 0 },
      seed: 301,
    });

    // Impact crack / noise slap
    layers.push({
      id: 'percussion-slap',
      name: 'Impact Click/Slap',
      enabled: true,
      solo: false,
      oscillatorType: 'noise',
      startTime: 0,
      duration: Math.min(duration, 0.12),
      gain: 0.65,
      pan: 0,
      startFrequency: 3000,
      endFrequency: 3000,
      frequencyCurve: 'constant',
      envelope: { attack: 0.001, decay: 0.04, sustain: 0.0, release: 0.02 },
      lowPassFilter: { enabled: true, cutoff: 6500, q: 2.2 },
      highPassFilter: { enabled: true, cutoff: 400, q: 1.2 },
      distortion: { enabled: false, amount: 0 },
      delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
      frequencyModulation: { enabled: false, modFrequency: 100, modDepth: 0 },
      seed: 302,
    });

    if (preset === 'accurate') {
      // Ring resonance tail
      layers.push({
        id: 'percussion-tail',
        name: 'Resonance Ring',
        enabled: true,
        solo: false,
        oscillatorType: 'sine',
        startTime: 0.02,
        duration: duration * 0.7,
        gain: 0.4,
        pan: 0.1,
        startFrequency: startF,
        endFrequency: startF * 0.9,
        frequencyCurve: 'exponential',
        envelope: { attack: 0.005, decay: duration * 0.4, sustain: 0.05, release: 0.06 },
        lowPassFilter: { enabled: true, cutoff: 4000, q: 3.0 },
        highPassFilter: { enabled: false, cutoff: 80, q: 1 },
        distortion: { enabled: false, amount: 0 },
        delay: { enabled: true, time: 0.05, feedback: 0.25, mix: 0.2 },
        frequencyModulation: { enabled: false, modFrequency: 50, modDepth: 0 },
        seed: 303,
      });
    }
  } else {
    // Mixed: Combination of tonal core and noise overlay
    layers.push({
      id: 'mixed-tone',
      name: 'Tonal Foundation',
      enabled: true,
      solo: false,
      oscillatorType: analysis.tonalVsNoisyScore > 0.4 ? 'sine' : 'sawtooth',
      startTime: 0,
      duration,
      gain: 0.75,
      pan: -0.1,
      startFrequency: startF,
      endFrequency: endF,
      frequencyCurve: freqCurve,
      envelope: { attack, decay, sustain, release },
      lowPassFilter: {
        enabled: true,
        cutoff: Math.max(600, Math.min(10000, analysis.averageSpectralCentroid * 1.5)),
        q: 1.5,
      },
      highPassFilter: { enabled: false, cutoff: 50, q: 0.7 },
      distortion: { enabled: preset !== 'tiny', amount: 0.15 },
      delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
      frequencyModulation: { enabled: false, modFrequency: 75, modDepth: 0 },
      seed: 401,
    });

    layers.push({
      id: 'mixed-noise',
      name: 'Noise Texture',
      enabled: true,
      solo: false,
      oscillatorType: 'noise',
      startTime: 0,
      duration: duration * 0.9,
      gain: 0.55,
      pan: 0.1,
      startFrequency: 2000,
      endFrequency: 2000,
      frequencyCurve: 'constant',
      envelope: { attack: attack * 0.8, decay: decay * 0.9, sustain: sustain * 0.5, release },
      lowPassFilter: {
        enabled: true,
        cutoff: Math.max(1000, Math.min(14000, analysis.averageSpectralCentroid * 2.0)),
        q: 1.2,
      },
      highPassFilter: { enabled: true, cutoff: 250, q: 0.8 },
      distortion: { enabled: false, amount: 0 },
      delay: { enabled: preset === 'accurate', time: 0.06, feedback: 0.2, mix: 0.18 },
      frequencyModulation: { enabled: false, modFrequency: 90, modDepth: 0 },
      seed: 402,
    });
  }

  const recipe: SoundRecipe = {
    version: 1,
    name: `${classification.toUpperCase()} Approximation`,
    category: classification,
    duration,
    masterGain: 0.8,
    layers,
    metadata: {
      originalFileName,
      originalDuration: analysis.duration,
      originalSizeBytes,
      generationPreset: preset,
      classification,
      createdAt: new Date().toISOString(),
      generator: 'Resonance SFX Heuristic Generator',
    },
  };

  return recipe;
}
