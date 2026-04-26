export type Rng = { readonly state: number };

export function createRng(seed: number): Rng {
  return { state: seed | 0 };
}

// Mulberry32 (Tommy Ettinger, 2017) — small public-domain PRNG.
export function nextFloat(rng: Rng): [number, Rng] {
  const state = (rng.state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, { state }];
}
