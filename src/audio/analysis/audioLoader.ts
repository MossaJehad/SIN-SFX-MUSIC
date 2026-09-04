import { APP_CONFIG } from '@/config/appConfig';

export interface LoadedAudio {
  buffer: AudioBuffer;
  originalSizeBytes: number;
  fileName: string;
  fileType: string;
}

/**
 * Loads, validates, and decodes an audio file into an AudioBuffer using the browser's Web Audio API.
 * All operations execute locally in memory. No network transfer occurs.
 */
export async function loadAndDecodeAudioFile(
  file: File,
  audioContext: BaseAudioContext
): Promise<LoadedAudio> {
  // 1. File Size Validation
  if (file.size === 0) {
    throw new Error(
      'The selected audio file is empty (0 bytes). Please select a valid audio file.'
    );
  }

  if (file.size > APP_CONFIG.limits.maxFileSizeBytes) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File size (${sizeMb} MB) exceeds the 10 MB limit. Please select a shorter game sound effect.`
    );
  }

  // 2. Read file to ArrayBuffer
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    throw new Error(
      'Failed to read the audio file from disk. Please check file permissions and try again.'
    );
  }

  // 3. Decode audio data
  let decodedBuffer: AudioBuffer;
  try {
    // Clone arrayBuffer before decoding to prevent detached buffer errors
    decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error(
      `Unable to decode audio format for "${file.name}". Supported formats include WAV, MP3, OGG, and WebM.`
    );
  }

  // 4. Duration Validation (Game SFX max 3.0s, allow 3.05s tolerance for encoder padding)
  if (decodedBuffer.duration > APP_CONFIG.limits.maxDurationSeconds + 0.05) {
    throw new Error(
      `Audio duration (${decodedBuffer.duration.toFixed(2)}s) exceeds the 3.0-second limit for short game sound effects. Please trim the audio before uploading.`
    );
  }

  if (decodedBuffer.length === 0 || decodedBuffer.duration === 0) {
    throw new Error('Decoded audio stream contains zero samples. The file may be corrupt.');
  }

  return {
    buffer: decodedBuffer,
    originalSizeBytes: file.size,
    fileName: file.name,
    fileType: file.type || 'audio/wav',
  };
}
