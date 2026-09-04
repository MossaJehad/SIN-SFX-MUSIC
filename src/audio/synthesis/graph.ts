import { SoundLayer, SoundRecipe } from '@/types/recipe';
import { generateDeterministicWhiteNoise } from './noise';
import { makeDistortionCurve } from './distortion';

export interface LayerNodes {
  sourceNode: AudioNode;
  envelopeGain: GainNode;
  lowPass?: BiquadFilterNode;
  highPass?: BiquadFilterNode;
  distortion?: WaveShaperNode;
  panner?: StereoPannerNode;
  delay?: DelayNode;
  delayFeedback?: GainNode;
  fmOsc?: OscillatorNode;
  fmGain?: GainNode;
}

/**
 * Checks whether a specific layer should be active given the solo/mute states across all layers.
 */
export function isLayerActive(layer: SoundLayer, allLayers: SoundLayer[]): boolean {
  if (!layer.enabled) return false;
  const anySolo = allLayers.some((l) => l.solo);
  if (anySolo) {
    return !!layer.solo;
  }
  return true;
}

/**
 * Connects a layer's procedural DSP pipeline to the target audio node.
 * Uses exact scheduled parameter automations for frame-accurate timing.
 */
export function buildLayerAudioGraph(
  context: BaseAudioContext,
  layer: SoundLayer,
  destination: AudioNode,
  scheduleOffset = 0
): LayerNodes | null {
  const startTime = Math.max(context.currentTime + scheduleOffset + layer.startTime, 0);
  const duration = Math.max(0.005, layer.duration);
  const stopTime = startTime + duration;

  // 1. Create Source: Oscillator or Deterministic Noise
  let sourceNode: AudioNode;
  let oscNode: OscillatorNode | undefined;
  let noiseNode: AudioBufferSourceNode | undefined;

  if (layer.oscillatorType === 'noise') {
    const noiseBuffer = generateDeterministicWhiteNoise(context, duration, layer.seed);
    noiseNode = context.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    sourceNode = noiseNode;
  } else {
    oscNode = context.createOscillator();
    oscNode.type = layer.oscillatorType;

    const startFreq = Math.max(20, Math.min(22000, layer.startFrequency));
    const endFreq = Math.max(20, Math.min(22000, layer.endFrequency));

    oscNode.frequency.setValueAtTime(startFreq, startTime);

    if (layer.frequencyCurve === 'exponential' && startFreq > 0 && endFreq > 0) {
      oscNode.frequency.exponentialRampToValueAtTime(endFreq, stopTime);
    } else if (layer.frequencyCurve === 'linear') {
      oscNode.frequency.linearRampToValueAtTime(endFreq, stopTime);
    } else {
      // Constant
      oscNode.frequency.setValueAtTime(startFreq, startTime);
    }

    sourceNode = oscNode;
  }

  // 2. Optional Frequency Modulation (FM)
  let fmOsc: OscillatorNode | undefined;
  let fmGain: GainNode | undefined;
  if (oscNode && layer.frequencyModulation.enabled && layer.frequencyModulation.modDepth > 0) {
    fmOsc = context.createOscillator();
    fmGain = context.createGain();
    fmOsc.frequency.setValueAtTime(layer.frequencyModulation.modFrequency, startTime);
    fmGain.gain.setValueAtTime(layer.frequencyModulation.modDepth, startTime);
    fmOsc.connect(fmGain);
    fmGain.connect(oscNode.frequency);
    fmOsc.start(startTime);
    fmOsc.stop(stopTime);
  }

  // 3. Amplitude Envelope (ADSR)
  const envGain = context.createGain();
  envGain.gain.setValueAtTime(0, startTime);

  const attack = Math.max(0.001, layer.envelope.attack);
  const decay = Math.max(0.001, layer.envelope.decay);
  const sustainLevel = Math.max(0, Math.min(1, layer.envelope.sustain));
  const release = Math.max(0.001, layer.envelope.release);

  // Time milestones
  const attackEnd = startTime + Math.min(attack, duration * 0.3);
  const decayEnd = attackEnd + Math.min(decay, Math.max(0, duration - attack - release));
  const sustainEnd = Math.max(decayEnd, stopTime - release);

  // Target peak gain
  const peakGain = Math.max(0, Math.min(1.5, layer.gain));
  const sustainGain = peakGain * sustainLevel;

  // Schedule ADSR curve
  envGain.gain.setValueAtTime(0.0001, startTime);
  envGain.gain.linearRampToValueAtTime(peakGain, attackEnd);
  envGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustainGain), decayEnd);
  envGain.gain.setValueAtTime(Math.max(0.0001, sustainGain), sustainEnd);
  envGain.gain.linearRampToValueAtTime(0.00001, stopTime);

  // 4. Filters & Effects Chain
  let currentOutput: AudioNode = sourceNode;

  // Connect source through envelope
  currentOutput.connect(envGain);
  currentOutput = envGain;

  // High-Pass Filter
  let hpFilter: BiquadFilterNode | undefined;
  if (layer.highPassFilter.enabled) {
    hpFilter = context.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.setValueAtTime(
      Math.max(10, Math.min(20000, layer.highPassFilter.cutoff)),
      startTime
    );
    hpFilter.Q.setValueAtTime(Math.max(0.1, Math.min(20, layer.highPassFilter.q)), startTime);
    currentOutput.connect(hpFilter);
    currentOutput = hpFilter;
  }

  // Low-Pass Filter
  let lpFilter: BiquadFilterNode | undefined;
  if (layer.lowPassFilter.enabled) {
    lpFilter = context.createBiquadFilter();
    lpFilter.type = 'lowpass';
    lpFilter.frequency.setValueAtTime(
      Math.max(20, Math.min(20000, layer.lowPassFilter.cutoff)),
      startTime
    );
    lpFilter.Q.setValueAtTime(Math.max(0.1, Math.min(20, layer.lowPassFilter.q)), startTime);
    currentOutput.connect(lpFilter);
    currentOutput = lpFilter;
  }

  // Distortion / Saturation
  let distortionNode: WaveShaperNode | undefined;
  if (layer.distortion.enabled && layer.distortion.amount > 0.01) {
    distortionNode = context.createWaveShaper();
    distortionNode.curve = makeDistortionCurve(
      layer.distortion.amount
    ) as unknown as Float32Array<ArrayBuffer>;
    distortionNode.oversample = '2x';
    currentOutput.connect(distortionNode);
    currentOutput = distortionNode;
  }

  // Stereo Panner (if supported in context)
  let pannerNode: StereoPannerNode | undefined;
  if (typeof context.createStereoPanner === 'function' && layer.pan !== 0) {
    pannerNode = context.createStereoPanner();
    pannerNode.pan.setValueAtTime(Math.max(-1, Math.min(1, layer.pan)), startTime);
    currentOutput.connect(pannerNode);
    currentOutput = pannerNode;
  }

  // Delay Effect
  let delayNode: DelayNode | undefined;
  let feedbackNode: GainNode | undefined;
  if (layer.delay.enabled && layer.delay.mix > 0.01) {
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    delayNode = context.createDelay(1.0);
    feedbackNode = context.createGain();

    delayNode.delayTime.setValueAtTime(Math.max(0.01, Math.min(0.5, layer.delay.time)), startTime);
    feedbackNode.gain.setValueAtTime(Math.max(0, Math.min(0.9, layer.delay.feedback)), startTime);

    const mix = Math.max(0, Math.min(1, layer.delay.mix));
    dryGain.gain.setValueAtTime(1 - mix * 0.5, startTime);
    wetGain.gain.setValueAtTime(mix, startTime);

    // Split signal to dry & wet
    currentOutput.connect(dryGain);
    currentOutput.connect(delayNode);
    delayNode.connect(feedbackNode);
    feedbackNode.connect(delayNode);
    delayNode.connect(wetGain);

    const delayMixer = context.createGain();
    dryGain.connect(delayMixer);
    wetGain.connect(delayMixer);
    currentOutput = delayMixer;
  }

  // Final connection to destination
  currentOutput.connect(destination);

  // Start & stop sources
  if (oscNode) {
    oscNode.start(startTime);
    oscNode.stop(stopTime);
  } else if (noiseNode) {
    noiseNode.start(startTime);
    noiseNode.stop(stopTime);
  }

  return {
    sourceNode,
    envelopeGain: envGain,
    lowPass: lpFilter,
    highPass: hpFilter,
    distortion: distortionNode,
    panner: pannerNode,
    delay: delayNode,
    delayFeedback: feedbackNode,
    fmOsc,
    fmGain,
  };
}

/**
 * Builds and connects all active layers of a recipe to a destination,
 * including a master gain stage and a dynamics soft-clipper to prevent clipping.
 */
export function buildRecipeGraph(
  context: BaseAudioContext,
  recipe: SoundRecipe,
  destination: AudioNode,
  scheduleOffset = 0
): void {
  // Master gain
  const masterGain = context.createGain();
  const normalizedMaster = Math.max(0, Math.min(1.0, recipe.masterGain ?? 0.8));
  masterGain.gain.setValueAtTime(normalizedMaster, context.currentTime + scheduleOffset);

  // Dynamics soft limiter to strictly prevent clipping
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-1.0, context.currentTime + scheduleOffset);
  limiter.knee.setValueAtTime(6.0, context.currentTime + scheduleOffset);
  limiter.ratio.setValueAtTime(12.0, context.currentTime + scheduleOffset);
  limiter.attack.setValueAtTime(0.002, context.currentTime + scheduleOffset);
  limiter.release.setValueAtTime(0.05, context.currentTime + scheduleOffset);

  masterGain.connect(limiter);
  limiter.connect(destination);

  // Build each active layer
  for (const layer of recipe.layers) {
    if (isLayerActive(layer, recipe.layers)) {
      buildLayerAudioGraph(context, layer, masterGain, scheduleOffset);
    }
  }
}
