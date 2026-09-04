import '@testing-library/jest-dom';

// Polyfill AudioBuffer for jsdom unit tests
if (typeof AudioBuffer === 'undefined') {
  class MockAudioBuffer {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    duration: number;
    private channelData: Float32Array[];

    constructor(options: { numberOfChannels?: number; length: number; sampleRate: number }) {
      this.numberOfChannels = options.numberOfChannels || 1;
      this.length = options.length;
      this.sampleRate = options.sampleRate;
      this.duration = this.length / this.sampleRate;
      this.channelData = [];
      for (let i = 0; i < this.numberOfChannels; i++) {
        this.channelData.push(new Float32Array(this.length));
      }
    }

    getChannelData(channel: number): Float32Array {
      return this.channelData[channel] || new Float32Array(this.length);
    }

    copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset = 0): void {
      const source = this.getChannelData(channelNumber);
      destination.set(source.subarray(bufferOffset, bufferOffset + destination.length));
    }

    copyToChannel(source: Float32Array, channelNumber: number, bufferOffset = 0): void {
      const dest = this.getChannelData(channelNumber);
      dest.set(source, bufferOffset);
    }
  }

  (globalThis as unknown as { AudioBuffer: typeof MockAudioBuffer }).AudioBuffer = MockAudioBuffer;
}
