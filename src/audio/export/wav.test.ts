import { describe, it, expect } from 'vitest';
import { audioBufferToWav } from './wav';

describe('WAV Encoder', () => {
  it('generates valid RIFF / WAVE header structure', () => {
    const sampleRate = 44100;
    const length = 100;
    const buffer = new AudioBuffer({ numberOfChannels: 1, length, sampleRate });
    const data = buffer.getChannelData(0);
    data.fill(0.2);

    const arrayBuffer = audioBufferToWav(buffer);
    const view = new DataView(arrayBuffer);

    // Read ASCII RIFF
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    expect(riff).toBe('RIFF');

    // Read ASCII WAVE
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(wave).toBe('WAVE');

    // Read format chunk
    const fmt = String.fromCharCode(
      view.getUint8(12),
      view.getUint8(13),
      view.getUint8(14),
      view.getUint8(15)
    );
    expect(fmt).toBe('fmt ');

    // PCM format code = 1
    expect(view.getUint16(20, true)).toBe(1);

    // Channels = 1
    expect(view.getUint16(22, true)).toBe(1);

    // Sample rate = 44100
    expect(view.getUint32(24, true)).toBe(sampleRate);

    // Bits per sample = 16
    expect(view.getUint16(34, true)).toBe(16);

    // Data chunk
    const dataChunk = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39)
    );
    expect(dataChunk).toBe('data');

    // Total size = 44 bytes header + (100 samples * 2 bytes/sample) = 244 bytes
    expect(arrayBuffer.byteLength).toBe(44 + length * 2);
  });
});
