// Compact score formatter for the on-screen sidebar/bottom strip,
// the game-over modal, and the leaderboard. The portrait bottom strip
// lays out as `score | preview | icons` (docs/09-responsive-layout.md
// "Bottom strip contents"); letting the score grow without bound
// pushes the preview off-center and the icons off the board, so the
// displayed text is capped at five characters by collapsing into
// three-significant-figure notation once it would otherwise grow
// wider.
//
// Rule, applied verbatim by the implementation below:
//   - 0-999             -> the raw integer (e.g. "27", "999")
//   - 1000-9999         -> "<n.nn>k"   (e.g. "1.00k", "4.04k", "9.99k")
//   - 10000-99999       -> "<nn.n>k"   (e.g. "10.0k", "12.3k")
//   - 100000-999999     -> "<nnn>k"    (e.g. "123k", "999k")
//   - 1000000-9999999   -> "<n.nn>M"   (e.g. "1.00M", "9.99M")
//   - 10000000-99999999 -> "<nn.n>M"   (e.g. "12.3M")
//   - >=100000000       -> "<nnn>M"    (e.g. "123M", "821M")
//
// All conversions truncate toward zero rather than round to nearest:
// the displayed value never overstates the player's actual score, so
// "1.10k" never appears at 1099.

export function formatScore(score: number): string {
  if (score < 1000) return String(score);
  if (score < 1_000_000) return formatScaled(score, 1000, 'k');
  return formatScaled(score, 1_000_000, 'M');
}

function formatScaled(score: number, divisor: number, suffix: string): string {
  // `x100` is the suffixed value scaled by 100 and truncated toward
  // zero. Computing it with `Math.floor((score * 100) / divisor)`
  // keeps the work in integer-valued floats so FP imprecision in
  // `score / divisor` can't push us across a digit boundary (e.g.
  // 1090 displaying as "1.08k" instead of "1.09k"). Scores stay well
  // below the safe-integer ceiling, so `score * 100` is exact.
  const x100 = Math.floor((score * 100) / divisor);
  if (x100 < 1000) {
    // 1.00 to 9.99
    const whole = Math.floor(x100 / 100);
    const cents = (x100 % 100).toString().padStart(2, '0');
    return `${whole}.${cents}${suffix}`;
  }
  if (x100 < 10_000) {
    // 10.0 to 99.9 (drop the units digit of the cents)
    const tenths = Math.floor(x100 / 10);
    return `${Math.floor(tenths / 10)}.${tenths % 10}${suffix}`;
  }
  // 100 to 999
  return `${Math.floor(x100 / 100)}${suffix}`;
}
