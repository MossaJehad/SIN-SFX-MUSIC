import { describe, it, expect } from 'vitest';
import { createSeededRandom } from './noise';

describe('Deterministic Seeded PRNG', () => {
  it('generates identical sequence given the same seed', () => {
    const rngA = createSeededRandom(12345);
    const rngB = createSeededRandom(12345);

    const seqA = Array.from({ length: 50 }, () => rngA());
    const seqB = Array.from({ length: 50 }, () => rngB());

    expect(seqA).toEqual(seqB);
  });

  it('generates different sequence for different seeds', () => {
    const rngA = createSeededRandom(101);
    const rngB = createSeededRandom(202);

    const valA = rngA();
    const valB = rngB();

    expect(valA).not.toEqual(valB);
  });

  it('outputs numbers strictly within [0, 1) interval', () => {
    const rng = createSeededRandom(999);
    for (let i = 0; i < 1000; i++) {
      const num = rng();
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThan(1);
    }
  });
});
