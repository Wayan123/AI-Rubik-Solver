import Cube from "cubejs";
import { type CubeState, isSolved } from "./cube.ts";
import { type Move, parseMoves } from "./moves.ts";

let initialized = false;

/** Build the two-phase pruning tables (≈1–2 s, once per process). */
export function initSolver(): void {
  if (initialized) return;
  Cube.initSolver();
  initialized = true;
}

/** Kociemba two-phase solution (cubejs). Not guaranteed optimal; usually ≤ 22 moves. */
export function solve(state: CubeState): Move[] {
  if (isSolved(state)) return [];
  initSolver();
  const text = Cube.fromString(state).solve();
  const parsed = parseMoves(text);
  if (!parsed.ok) throw new Error(`solver produced invalid output: ${text}`);
  return parsed.moves;
}

/** Upper bound on distance-to-solved in half-turn metric (length of the two-phase solution). */
export function kociembaDistance(state: CubeState): number {
  return solve(state).length;
}

/** Reference implementation from cubejs, used for cross-checking the move tables. */
export function cubejsApply(moves: string): CubeState {
  const c = new Cube();
  if (moves.trim()) c.move(moves);
  return c.asString();
}
