import { applyMove, type CubeState, isSolved, SOLVED } from "./cube.ts";
import { ALL_MOVES, type Move } from "./moves.ts";
import { solve } from "./solver.ts";

/** Radius of the exact lookup table around the solved state (≈47k states, a few MB). */
export const TABLE_RADIUS = 4;
/** Distances up to this value are computed exactly (table radius + forward search radius). */
export const EXACT_LIMIT = TABLE_RADIUS * 2;

let table: Map<CubeState, number> | null = null;

const sameFace = (a: Move | undefined, b: Move) => a !== undefined && a[0] === b[0];

function buildTable(): Map<CubeState, number> {
  const t = new Map<CubeState, number>([[SOLVED, 0]]);
  let frontier: Array<[CubeState, Move | undefined]> = [[SOLVED, undefined]];
  for (let d = 1; d <= TABLE_RADIUS; d++) {
    const next: Array<[CubeState, Move | undefined]> = [];
    for (const [s, last] of frontier) {
      for (const m of ALL_MOVES) {
        if (sameFace(last, m)) continue;
        const n = applyMove(s, m);
        if (!t.has(n)) {
          t.set(n, d);
          next.push([n, m]);
        }
      }
    }
    frontier = next;
  }
  return t;
}

/** Pre-build the lookup table (otherwise built lazily on first use). */
export function initDistanceTable(): void {
  table ??= buildTable();
}

/** Exact half-turn distance if ≤ TABLE_RADIUS + maxForward, otherwise null. */
export function exactDistance(state: CubeState, maxForward: number = TABLE_RADIUS): number | null {
  if (isSolved(state)) return 0;
  initDistanceTable();
  const t = table!;
  let best = Number.POSITIVE_INFINITY;
  const dfs = (s: CubeState, depthLeft: number, depth: number, last: Move | undefined) => {
    if (depthLeft === 0) {
      const v = t.get(s);
      if (v !== undefined && depth + v < best) best = depth + v;
      return;
    }
    for (const m of ALL_MOVES) {
      if (sameFace(last, m)) continue;
      dfs(applyMove(s, m), depthLeft - 1, depth + 1, m);
    }
  };
  for (let level = 0; level <= maxForward; level++) {
    dfs(state, level, 0, undefined);
    // After level L every state within L + TABLE_RADIUS has been found with its exact distance.
    if (best <= level + TABLE_RADIUS) break;
  }
  return Number.isFinite(best) ? best : null;
}

export interface Distance {
  /** Half-turn metric distance (exact) or a two-phase upper bound. */
  value: number;
  exact: boolean;
}

export interface DistanceOptions {
  /**
   * "full" (default): exact up to EXACT_LIMIT (8); up to ~1.5 s for far states.
   * "fast": exact up to TABLE_RADIUS + 2 (6); ~1 ms; for per-move trajectories.
   */
  mode?: "full" | "fast";
}

/** Distance to solved: exact within the mode's radius, otherwise Kociemba two-phase upper bound (above that radius). */
export function distanceToSolved(state: CubeState, options: DistanceOptions = {}): Distance {
  const forward = options.mode === "fast" ? 2 : TABLE_RADIUS;
  const exact = exactDistance(state, forward);
  if (exact !== null) return { value: exact, exact: true };
  return { value: Math.max(TABLE_RADIUS + forward + 1, solve(state).length), exact: false };
}
