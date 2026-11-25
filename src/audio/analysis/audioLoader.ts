import { APP_CONFIG } from '@/config/appConfig';

export interface LoadedAudio {
  buffer: AudioBuffer;
  channels: Float32Array[];
  originalSizeBytes: number;
  fileName: string;
  fileType: string;
  warning?: string;
}

/**
 * Extracts independent Float32Array channel copies from an AudioBuffer.
 */
export function extractAudioBufferChannels(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(new Float32Array(buffer.getChannelData(c)));
  }
  return channels;
}

/**
 * Creates an AudioBuffer from channel Float32Arrays using an AudioContext/BaseAudioContext.
 */
export function createAudioBufferFromChannels(
  audioContext: BaseAudioContext,
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const numChannels = Math.max(1, channels.length);
  const length = Math.max(1, channels[0]?.length ?? 1);
  const buffer = audioContext.createBuffer(numChannels, length, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const ch = channels[c] ?? channels[0]!;
    buffer.getChannelData(c).set(ch);
  }
  return buffer;
}

/**
 * Loads, validates, and decodes an audio file into an AudioBuffer using the browser's Web Audio API.
 * All operations execute locally in memory. No network transfer occurs.
 */
export async function loadAndDecodeAudioFile(
  file: File,
  audioContext: BaseAudioContext
): Promise<LoadedAudio> {
  if (file.size === 0) {
    throw new Error(
      'The selected audio file is empty (0 bytes). Please select a valid audio file.'
    );
  }

  if (file.size > APP_CONFIG.limits.maxFileSizeBytes) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const limitMb = Math.round(APP_CONFIG.limits.maxFileSizeBytes / (1024 * 1024));
    throw new Error(
      `File size (${sizeMb} MB) exceeds the ${limitMb} MB browser memory limit. Please select a smaller audio file.`
    );
  }

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    throw new Error(
      'Failed to read the audio file from disk. Please check file permissions and try again.'
    );
  }

  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error(
      `Unable to decode audio format for "${file.name}". Supported browser formats include WAV, MP3, OGG, WebM, FLAC, and M4A.`
    );
  }

  if (decodedBuffer.length === 0 || decodedBuffer.duration === 0) {
    throw new Error('Decoded audio stream contains zero samples. The file may be corrupt.');
  }

  if (decodedBuffer.duration > APP_CONFIG.limits.maxDurationSeconds + 0.05) {
    throw new Error(
      `Audio duration (${decodedBuffer.duration.toFixed(2)}s) exceeds the ${APP_CONFIG.limits.maxDurationSeconds.toFixed(1)}-second limit. Please trim the audio before uploading.`
    );
  }

  const warning =
    decodedBuffer.duration > APP_CONFIG.limits.recommendedExactDurationSeconds
      ? `Long audio (${decodedBuffer.duration.toFixed(2)}s): Exact mode will produce large Fourier coefficient tables; Optimized or Procedural mode is recommended for compact export.`
      : undefined;

  return {
    buffer: decodedBuffer,
    channels: extractAudioBufferChannels(decodedBuffer),
    originalSizeBytes: file.size,
    fileName: file.name,
    fileType: file.type || 'audio/wav',
    warning,
  };
}
