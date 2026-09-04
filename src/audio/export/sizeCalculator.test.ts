import { describe, it, expect } from 'vitest';
import { calculateSizeReport, formatBytes, getByteLength } from './sizeCalculator';
import { BUILT_IN_EXAMPLES } from '@/examples/builtInExamples';

describe('Size Reporting & Calculations', () => {
  it('correctly reports UTF-8 byte lengths', () => {
    expect(getByteLength('hello')).toBe(5);
    expect(getByteLength('🎵')).toBe(4); // 4-byte unicode character
  });

  it('formats byte numbers into human-readable strings', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2097152)).toBe('2.00 MB');
  });

  it('calculates size comparison and reductions honestly', () => {
    const example = BUILT_IN_EXAMPLES['coin-pickup']!;
    const originalSizeBytes = 80 * 1024; // 80 KB original audio asset

    const report = calculateSizeReport(example, originalSizeBytes);

    expect(report.originalSizeBytes).toBe(originalSizeBytes);
    expect(report.minifiedJsonBytes).toBeLessThan(2500); // Recipe JSON should be compact (< 2.5KB)
    expect(report.standaloneRuntimeBytes).toBeGreaterThan(1000);
    expect(report.totalFirstUseBytes).toBe(
      report.standaloneRuntimeBytes + report.minifiedJsonBytes
    );
    expect(report.additionalSoundBytes).toBe(report.minifiedJsonBytes);
    expect(report.reductionPercentage).toBeGreaterThan(90);
    expect(report.isLargerThanOriginal).toBe(false);
  });

  it('honestly detects when procedural first-use bundle is larger than tiny original', () => {
    const example = BUILT_IN_EXAMPLES['ui-click']!;
    const tinyOriginal = 500; // 500 byte asset

    const report = calculateSizeReport(example, tinyOriginal);
    expect(report.isLargerThanOriginal).toBe(true);
    expect(report.reductionPercentage).toBeLessThan(0);
  });
});
