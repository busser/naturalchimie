import { describe, it, expect } from 'vitest';
import { formatScore } from './format-score';

describe('formatScore', () => {
  it('returns raw integers below the k threshold', () => {
    expect(formatScore(0)).toBe('0');
    expect(formatScore(27)).toBe('27');
    expect(formatScore(123)).toBe('123');
    expect(formatScore(999)).toBe('999');
  });

  it('uses "<n.nn>k" for 1000-9999', () => {
    expect(formatScore(1000)).toBe('1.00k');
    expect(formatScore(1234)).toBe('1.23k');
    expect(formatScore(4049)).toBe('4.04k');
    expect(formatScore(9999)).toBe('9.99k');
  });

  it('uses "<nn.n>k" for 10000-99999', () => {
    expect(formatScore(10_000)).toBe('10.0k');
    expect(formatScore(12_345)).toBe('12.3k');
    expect(formatScore(82_098)).toBe('82.0k');
    expect(formatScore(99_999)).toBe('99.9k');
  });

  it('uses "<nnn>k" for 100000-999999', () => {
    expect(formatScore(100_000)).toBe('100k');
    expect(formatScore(123_456)).toBe('123k');
    expect(formatScore(481_000)).toBe('481k');
    expect(formatScore(999_999)).toBe('999k');
  });

  it('uses "<n.nn>M" for 1,000,000-9,999,999', () => {
    expect(formatScore(1_000_000)).toBe('1.00M');
    expect(formatScore(1_234_567)).toBe('1.23M');
    expect(formatScore(9_999_999)).toBe('9.99M');
  });

  it('uses "<nn.n>M" for 10,000,000-99,999,999', () => {
    expect(formatScore(10_000_000)).toBe('10.0M');
    expect(formatScore(12_345_678)).toBe('12.3M');
    expect(formatScore(99_999_999)).toBe('99.9M');
  });

  it('uses "<nnn>M" for 100,000,000+', () => {
    expect(formatScore(100_000_000)).toBe('100M');
    expect(formatScore(821_000_000)).toBe('821M');
    expect(formatScore(999_999_999)).toBe('999M');
  });

  it('stays at five characters or fewer across the whole tested range', () => {
    const samples = [
      0, 999, 1000, 9999, 10_000, 99_999, 100_000, 999_999, 1_000_000,
      9_999_999, 10_000_000, 99_999_999, 100_000_000, 999_999_999,
    ];
    for (const n of samples) {
      expect(formatScore(n).length).toBeLessThanOrEqual(5);
    }
  });

  it('truncates rather than rounds (never overstates)', () => {
    expect(formatScore(1099)).toBe('1.09k');
    expect(formatScore(9999)).toBe('9.99k');
    expect(formatScore(99_999)).toBe('99.9k');
    expect(formatScore(1_399_999)).toBe('1.39M');
  });

  it('handles FP edge cases that could push 1090 to "1.08k"', () => {
    // 1090/1000 = 1.09 is not exact in IEEE 754, so a naive
    // implementation that divides first and floors second can yield
    // "1.08k" here. Integer-first math avoids that.
    expect(formatScore(1090)).toBe('1.09k');
  });
});
