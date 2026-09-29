import { FACES, type Face, type Move } from "./moves.ts";

/**
 * A cube state is a 54-character facelet string in Kociemba/cubejs order U R F D L B,
 * each face listed row-major as seen from outside with the standard net orientation.
 * Each character is the face letter whose center colour the sticker shows.
 */
export type CubeState = string;

export const SOLVED: CubeState = FACES.map((f) => f.repeat(9)).join("");

type Vec = readonly [number, number, number];

const NORMALS: Record<Face, Vec> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

/** 3D position (cubie coordinates in {-1,0,1}) of sticker (row, col) on a face. x→R, y→U, z→F. */
function stickerPosition(face: Face, r: number, c: number): Vec {
  switch (face) {
    case "U":
      return [c - 1, 1, r - 1];
    case "R":
      return [1, 1 - r, 1 - c];
    case "F":
      return [c - 1, 1 - r, 1];
    case "D":
      return [c - 1, -1, 1 - r];
    case "L":
      return [-1, 1 - r, c - 1];
    case "B":
      return [1 - c, 1 - r, -1];
  }
}

interface Sticker {
  pos: Vec;
  normal: Vec;
}

export const STICKERS: readonly Sticker[] = FACES.flatMap((face) =>
  Array.from({ length: 9 }, (_, i) => ({
    pos: stickerPosition(face, Math.floor(i / 3), i % 3),
    normal: NORMALS[face],
  })),
);

const key = (s: Sticker) => `${s.pos.join(",")}|${s.normal.join(",")}`;
const INDEX_BY_KEY = new Map(STICKERS.map((s, i) => [key(s), i]));

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Rotate v by -90° about unit axis a (clockwise when looking at the face from outside). */
function rotateClockwise(v: Vec, a: Vec): Vec {
  const c = cross(a, v);
  const d = dot(a, v);
  return [-c[0] + a[0] * d, -c[1] + a[1] * d, -c[2] + a[2] * d];
}

/** For a quarter clockwise turn of `face`: target[i] = index the sticker at i moves to. */
function buildQuarterTurn(face: Face): number[] {
  const axis = NORMALS[face];
  return STICKERS.map((s, i) => {
    if (dot(s.pos, axis) !== 1) return i;
    const moved = { pos: rotateClockwise(s.pos, axis), normal: rotateClockwise(s.normal, axis) };
    const j = INDEX_BY_KEY.get(key(moved));
    if (j === undefined) throw new Error(`broken move table for ${face}`);
    return j;
  });
}

const QUARTER: Record<Face, number[]> = Object.fromEntries(
  FACES.map((f) => [f, buildQuarterTurn(f)]),
) as Record<Face, number[]>;

function compose(a: number[], b: number[]): number[] {
  // apply a, then b
  return a.map((t) => b[t]!);
}

/** For each of the 18 moves: source[j] = index whose sticker lands at j. */
const SOURCE: Record<string, Int8Array> = {};
for (const face of FACES) {
  const q = QUARTER[face];
  const targets = [q, compose(q, q), compose(compose(q, q), q)];
  const names = [face, `${face}2`, `${face}'`];
  targets.forEach((target, k) => {
    const src = new Int8Array(54);
    for (let i = 0; i < 54; i++) src[target[i]!] = i;
    SOURCE[names[k]!] = src;
  });
}

export function applyMove(state: CubeState, move: Move): CubeState {
  const src = SOURCE[move];
  if (!src) throw new Error(`unknown move ${move}`);
  let out = "";
  for (let j = 0; j < 54; j++) out += state[src[j]!];
  return out;
}

export function applyMoves(state: CubeState, moves: readonly Move[]): CubeState {
  return moves.reduce(applyMove, state);
}

export function isSolved(state: CubeState): boolean {
  for (let f = 0; f < 6; f++) {
    const face = state.slice(f * 9, f * 9 + 9);
    if (face !== face[4]!.repeat(9)) return false;
  }
  return true;
}

/** True when the string has the right shape and colour counts (not a full solvability check). */
export function isWellFormed(state: string): boolean {
  if (!/^[URFDLB]{54}$/.test(state)) return false;
  return FACES.every((f) => state.split(f).length - 1 === 9);
}
