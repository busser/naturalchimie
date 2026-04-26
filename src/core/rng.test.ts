import { describe, it, expect } from 'vitest';
import { createRng, nextFloat, type Rng } from './rng';

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(sequence(createRng(42), 10)).toEqual(sequence(createRng(42), 10));
  });

  it('produces a different sequence for a different seed', () => {
    expect(sequence(createRng(42), 10)).not.toEqual(sequence(createRng(43), 10));
  });

  it('returns floats in [0, 1)', () => {
    let rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const [value, next] = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      rng = next;
    }
  });

  it('does not mutate the input rng', () => {
    const rng = createRng(123);
    const [first] = nextFloat(rng);
    const [second] = nextFloat(rng);
    expect(first).toBe(second);
  });
});

function sequence(rng: Rng, n: number): number[] {
  const values: number[] = [];
  let current = rng;
  for (let i = 0; i < n; i++) {
    const [value, next] = nextFloat(current);
    values.push(value);
    current = next;
  }
  return values;
}
