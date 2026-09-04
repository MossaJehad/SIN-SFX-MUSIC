import { describe, it, expect } from 'vitest';
import {
  calculateZeroCrossingRate,
  calculateSpectralCentroid,
  calculateSpectralFlatness,
  audioBufferToMono,
} from './analyzer';

describe('Audio Analysis Utilities', () => {
  it('computes correct zero-crossing rate on synthesized waves', () => {
    // Alternating square signal: +1, -1, +1, -1 has ZCR = 1.0
    const alternating = new Float32Array([1, -1, 1, -1, 1, -1]);
    const zcrAlternating = calculateZeroCrossingRate(alternating);
    expect(zcrAlternating).toBeCloseTo(1.0, 2);

    // Constant DC signal has ZCR = 0.0
    const dc = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
    const zcrDc = calculateZeroCrossingRate(dc);
    expect(zcrDc).toBe(0.0);
  });

  it('correctly shifts spectral centroid higher for high frequencies', () => {
    const sampleRate = 44100;
    const bins = 256;

    // Spectrum with peak in low bin
    const lowSpectrum = new Float32Array(bins);
    lowSpectrum[5] = 1.0;
    const lowCentroid = calculateSpectralCentroid(lowSpectrum, sampleRate);

    // Spectrum with peak in high bin
    const highSpectrum = new Float32Array(bins);
    highSpectrum[100] = 1.0;
    const highCentroid = calculateSpectralCentroid(highSpectrum, sampleRate);

    expect(highCentroid).toBeGreaterThan(lowCentroid);
  });

  it('identifies flat spectrum having higher spectral flatness than single peak', () => {
    // Flat noise spectrum
    const flatSpectrum = new Float32Array(128).fill(0.5);
    const flatValue = calculateSpectralFlatness(flatSpectrum);

    // Single tone peak
    const peakSpectrum = new Float32Array(128).fill(0.001);
    peakSpectrum[10] = 1.0;
    const peakValue = calculateSpectralFlatness(peakSpectrum);

    expect(flatValue).toBeGreaterThan(peakValue);
  });

  it('downmixes stereo AudioBuffer to mono correctly', () => {
    const buffer = new AudioBuffer({ length: 4, numberOfChannels: 2, sampleRate: 44100 });
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);

    ch0.set([1, 0, -1, 0.5]);
    ch1.set([0, 1, 1, -0.5]);

    const mono = audioBufferToMono(buffer);
    expect(mono.length).toBe(4);
    expect(mono[0]).toBeCloseTo(0.5, 3);
    expect(mono[1]).toBeCloseTo(0.5, 3);
    expect(mono[2]).toBeCloseTo(0.0, 3);
    expect(mono[3]).toBeCloseTo(0.0, 3);
  });
});
