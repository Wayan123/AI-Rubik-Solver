import {
  type Contestant,
  type ContestantConfig,
  type RaceConfig,
  type RaceEvent,
  runRace,
  type Solver,
} from "@rubik-arena/bench-core";
import { ALL_MOVES, type Move, mulberry32, scramble, solve } from "@rubik-arena/cube-engine";

/** Adapters that can run fully in the browser (demo mode, no runner). */
export const DEMO_ADAPTERS = ["kociemba", "random"] as const;

class BrowserKociemba implements Solver {
  readonly kind = "solver" as const;
  async nextMoves(state: string): Promise<Move[]> {
    // Yield so the UI can paint before the (synchronous) solver runs.
    await new Promise((r) => setTimeout(r, 0));
    return solve(state);
  }
}

class BrowserRandom implements Solver {
  readonly kind = "solver" as const;
  private readonly rand: () => number;
  constructor(
    seed: number,
    private readonly perTurn: number,
  ) {
    this.rand = mulberry32(seed);
  }
  async nextMoves(): Promise<Move[]> {
    await new Promise((r) => setTimeout(r, 120));
    return Array.from({ length: this.perTurn }, () => ALL_MOVES[Math.floor(this.rand() * 18)]!);
  }
}

function createDemoContestant(c: ContestantConfig): Contestant {
  if (c.adapter === "kociemba") return new BrowserKociemba();
  if (c.adapter === "random") return new BrowserRandom(Number(c.options?.seed ?? 1), c.maxMovesPerTurn);
  throw new Error(`${c.adapter} needs the local runner (npm start)`);
}

export function runDemoRace(
  input: {
    seed: number;
    depth: number;
    moves?: Move[];
    contestants: ContestantConfig[];
    concurrency: number;
  },
  emit: (e: RaceEvent) => void,
  signal: AbortSignal,
): Promise<unknown> {
  const moves = input.moves?.length ? input.moves : scramble(input.seed, input.depth);
  const race: RaceConfig = {
    id: `demo-${Date.now()}`,
    createdAt: new Date().toISOString(),
    scramble: { seed: input.seed, depth: moves.length, moves },
    concurrency: input.concurrency,
    contestants: input.contestants,
  };
  return runRace({ race, createContestant: createDemoContestant, signal, emit });
}
