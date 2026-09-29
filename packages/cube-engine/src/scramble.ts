import { FACES, type Face, type Move, SUFFIXES } from "./moves.ts";

/** Small, fast, deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AXIS: Record<Face, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };

/**
 * Seeded random-move scramble. Never repeats a face back-to-back and never produces
 * three consecutive turns on the same axis (e.g. R L R), matching common scrambler rules.
 */
export function scramble(seed: number, depth: number): Move[] {
  if (!Number.isInteger(depth) || depth < 0 || depth > 100)
    throw new RangeError("depth must be an integer 0–100");
  const rand = mulberry32(seed);
  const moves: Move[] = [];
  while (moves.length < depth) {
    const face = FACES[Math.floor(rand() * 6)]!;
    const suffix = SUFFIXES[Math.floor(rand() * 3)]!;
    const last = moves.at(-1)?.[0] as Face | undefined;
    const prev = moves.at(-2)?.[0] as Face | undefined;
    if (last === face) continue;
    if (last && prev && AXIS[last] === AXIS[face] && AXIS[prev] === AXIS[face]) continue;
    moves.push(`${face}${suffix}` as Move);
  }
  return moves;
}
