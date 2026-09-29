import { type CubeState, isWellFormed, SOLVED } from "./cube.ts";
import { FACES, type Face } from "./moves.ts";
import { mulberry32 } from "./scramble.ts";

/**
 * Cubie-level view of a facelet string, using Kociemba's standard slot order and facelet index tables.
 * Facelet indices follow the URFDLB 54-character layout used everywhere in this package.
 */
export const CORNER_NAMES = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"] as const;
export const EDGE_NAMES = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"] as const;

const CORNER_FACELETS: readonly (readonly [number, number, number])[] = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51],
];
const CORNER_COLORS: readonly (readonly [Face, Face, Face])[] = [
  ["U", "R", "F"],
  ["U", "F", "L"],
  ["U", "L", "B"],
  ["U", "B", "R"],
  ["D", "F", "R"],
  ["D", "L", "F"],
  ["D", "B", "L"],
  ["D", "R", "B"],
];
const EDGE_FACELETS: readonly (readonly [number, number])[] = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14],
];
const EDGE_COLORS: readonly (readonly [Face, Face])[] = [
  ["U", "R"],
  ["U", "F"],
  ["U", "L"],
  ["U", "B"],
  ["D", "R"],
  ["D", "F"],
  ["D", "L"],
  ["D", "B"],
  ["F", "R"],
  ["F", "L"],
  ["B", "L"],
  ["B", "R"],
];

/** Conventional colour scheme (white top, green front). Used for human-readable messages. */
export const FACE_COLOR_NAME: Record<Face, string> = {
  U: "white",
  R: "red",
  F: "green",
  D: "yellow",
  L: "orange",
  B: "blue",
};

export interface Cubies {
  /** Corner permutation: cp[slot] = piece. */
  cp: number[];
  /** Corner orientation 0–2 per slot. */
  co: number[];
  /** Edge permutation: ep[slot] = piece. */
  ep: number[];
  /** Edge orientation 0–1 per slot. */
  eo: number[];
}

export type StateValidation = { ok: true; cubies: Cubies } | { ok: false; errors: string[] };

const colorName = (f: string) => (f in FACE_COLOR_NAME ? `${FACE_COLOR_NAME[f as Face]} (${f})` : `"${f}"`);

function parity(perm: readonly number[]): number {
  let inversions = 0;
  for (let i = 0; i < perm.length; i++)
    for (let j = i + 1; j < perm.length; j++) if (perm[i]! > perm[j]!) inversions++;
  return inversions % 2;
}

/**
 * Check that a facelet string is a reachable (solvable) 3×3 state and return its cubies.
 * Errors are written for people entering a physical cube by hand.
 */
export function validateState(state: string): StateValidation {
  const errors: string[] = [];
  if (state.length !== 54)
    return { ok: false, errors: [`a cube state needs 54 stickers, got ${state.length}`] };
  const bad = [...new Set(state.replace(/[URFDLB]/g, ""))];
  if (bad.length)
    return { ok: false, errors: [`unknown sticker letter(s): ${bad.join(", ")} (use U R F D L B)`] };
  FACES.forEach((f, i) => {
    if (state[i * 9 + 4] !== f)
      errors.push(`the centre of face ${f} must be ${colorName(f)}; centres never move`);
  });
  for (const f of FACES) {
    const n = state.split(f).length - 1;
    if (n !== 9) errors.push(`${colorName(f)} appears ${n} times, needs exactly 9`);
  }
  if (errors.length || !isWellFormed(state)) return { ok: false, errors };

  const cp = new Array<number>(8).fill(-1);
  const co = new Array<number>(8).fill(0);
  for (let i = 0; i < 8; i++) {
    const fl = CORNER_FACELETS[i]!;
    let ori = 0;
    while (ori < 3 && state[fl[ori]!] !== "U" && state[fl[ori]!] !== "D") ori++;
    const stickers = fl.map((x) => state[x]!).join("");
    if (ori === 3) {
      errors.push(`corner at ${CORNER_NAMES[i]} (${stickers}) has no white or yellow sticker`);
      continue;
    }
    const c1 = state[fl[(ori + 1) % 3]!];
    const c2 = state[fl[(ori + 2) % 3]!];
    const piece = CORNER_COLORS.findIndex((c) => c[1] === c1 && c[2] === c2);
    if (piece === -1) {
      errors.push(`corner at ${CORNER_NAMES[i]} has colours ${stickers} that no real corner has`);
      continue;
    }
    cp[i] = piece;
    co[i] = ori;
  }
  const ep = new Array<number>(12).fill(-1);
  const eo = new Array<number>(12).fill(0);
  for (let i = 0; i < 12; i++) {
    const [a, b] = EDGE_FACELETS[i]!;
    const s0 = state[a]!;
    const s1 = state[b]!;
    const straight = EDGE_COLORS.findIndex((c) => c[0] === s0 && c[1] === s1);
    const flipped = EDGE_COLORS.findIndex((c) => c[0] === s1 && c[1] === s0);
    if (straight === -1 && flipped === -1) {
      errors.push(`edge at ${EDGE_NAMES[i]} has colours ${s0}${s1} that no real edge has`);
      continue;
    }
    ep[i] = straight !== -1 ? straight : flipped;
    eo[i] = straight !== -1 ? 0 : 1;
  }
  if (errors.length) return { ok: false, errors };

  const dupCorners = CORNER_NAMES.filter((_, p) => cp.filter((x) => x === p).length > 1);
  const dupEdges = EDGE_NAMES.filter((_, p) => ep.filter((x) => x === p).length > 1);
  if (dupCorners.length) errors.push(`corner piece(s) ${dupCorners.join(", ")} appear more than once`);
  if (dupEdges.length) errors.push(`edge piece(s) ${dupEdges.join(", ")} appear more than once`);
  if (errors.length) return { ok: false, errors };

  if (co.reduce((a, b) => a + b, 0) % 3 !== 0)
    errors.push("one corner is twisted in place (impossible on a real cube)");
  if (eo.reduce((a, b) => a + b, 0) % 2 !== 0)
    errors.push("one edge is flipped in place (impossible on a real cube)");
  if (parity(cp) !== parity(ep))
    errors.push("two pieces are swapped (permutation parity; impossible on a real cube)");
  return errors.length ? { ok: false, errors } : { ok: true, cubies: { cp, co, ep, eo } };
}

export function isSolvable(state: string): boolean {
  return validateState(state).ok;
}

/** Build a facelet string from cubies (inverse of validateState). */
export function fromCubies({ cp, co, ep, eo }: Cubies): CubeState {
  const f = SOLVED.split("");
  for (let i = 0; i < 8; i++) {
    for (let n = 0; n < 3; n++) f[CORNER_FACELETS[i]![(n + co[i]!) % 3]!] = CORNER_COLORS[cp[i]!]![n]!;
  }
  for (let i = 0; i < 12; i++) {
    for (let n = 0; n < 2; n++) f[EDGE_FACELETS[i]![(n + eo[i]!) % 2]!] = EDGE_COLORS[ep[i]!]![n]!;
  }
  return f.join("");
}

function shuffle(arr: number[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/**
 * Uniformly random reachable state from a seed (the approach official WCA scramblers use).
 * Deterministic: the same seed always gives the same cube.
 */
export function randomState(seed: number): CubeState {
  const rand = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  for (;;) {
    const cp = [0, 1, 2, 3, 4, 5, 6, 7];
    const ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    shuffle(cp, rand);
    shuffle(ep, rand);
    if (parity(cp) !== parity(ep)) [ep[0], ep[1]] = [ep[1]!, ep[0]!];
    const co = Array.from({ length: 7 }, () => Math.floor(rand() * 3));
    co.push((3 - (co.reduce((a, b) => a + b, 0) % 3)) % 3);
    const eo = Array.from({ length: 11 }, () => Math.floor(rand() * 2));
    eo.push(eo.reduce((a, b) => a + b, 0) % 2);
    const state = fromCubies({ cp, co, ep, eo });
    if (state !== SOLVED) return state;
  }
}
