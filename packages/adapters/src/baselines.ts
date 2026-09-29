import type { Solver } from "@rubik-arena/bench-core";
import { ALL_MOVES, type CubeState, type Move, mulberry32, solve } from "@rubik-arena/cube-engine";

/** Reference solver (Kociemba two-phase, cubejs). Sees the true state; shows what "good" looks like. */
export class KociembaSolver implements Solver {
  readonly kind = "solver" as const;
  async nextMoves(state: CubeState): Promise<Move[]> {
    return solve(state);
  }
}

/** Uniform random mover; lower bound for any contestant. */
export class RandomSolver implements Solver {
  readonly kind = "solver" as const;
  private readonly rand: () => number;
  constructor(
    seed = 1,
    private readonly perTurn = 10,
  ) {
    this.rand = mulberry32(seed);
  }
  async nextMoves(): Promise<Move[]> {
    return Array.from({ length: this.perTurn }, () => ALL_MOVES[Math.floor(this.rand() * ALL_MOVES.length)]!);
  }
}
