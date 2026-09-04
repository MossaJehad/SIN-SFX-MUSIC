/**
 * Mulberry32 deterministic 32-bit pseudo-random number generator.
 * Produces reproducible floating-point numbers in [0, 1) for a given seed.
 */
export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return function (): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates an AudioBuffer containing deterministic white noise.
 * Values are uniformly distributed in [-1.0, 1.0].
 */
export function generateDeterministicWhiteNoise(
  context: BaseAudioContext,
  durationSeconds: number,
  seed: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const frameCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const channelData = buffer.getChannelData(0);
  const rng = createSeededRandom(seed);

  for (let i = 0; i < frameCount; i++) {
    channelData[i] = rng() * 2 - 1;
  }

  return buffer;
}

/**
 * Creates an AudioBuffer containing deterministic pink noise (1/f spectrum).
 * Uses Paul Kellet's filter method on white noise.
 */
export function generateDeterministicPinkNoise(
  context: BaseAudioContext,
  durationSeconds: number,
  seed: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const frameCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const channelData = buffer.getChannelData(0);
  const rng = createSeededRandom(seed);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < frameCount; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    channelData[i] = Math.max(-1, Math.min(1, pink * 0.11)); // Normalize gain
  }

  return buffer;
}
