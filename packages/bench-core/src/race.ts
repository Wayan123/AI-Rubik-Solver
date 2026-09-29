import { applyMoves, type CubeState, SOLVED } from "@rubik-arena/cube-engine";
import { runContestant } from "./run.ts";
import type { Contestant, ContestantConfig, RaceConfig, RaceEvent, RunResult } from "./types.ts";

export const MAX_CONCURRENCY = 4;

export interface RaceOptions {
  race: RaceConfig;
  createContestant: (config: ContestantConfig) => Contestant;
  signal: AbortSignal;
  emit?: (event: RaceEvent) => void;
}

export function initialStateOf(race: RaceConfig): CubeState {
  return race.scramble.state ?? applyMoves(SOLVED, race.scramble.moves);
}

/** Run every contestant on the same scramble with bounded concurrency. Results keep config order. */
export async function runRace(opts: RaceOptions): Promise<RunResult[]> {
  const { race, emit = () => {} } = opts;
  const initialState = initialStateOf(race);
  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(race.concurrency)));
  emit({ type: "race_started", race, initialState });

  const results: RunResult[] = new Array(race.contestants.length);
  let next = 0;
  const worker = async () => {
    while (next < race.contestants.length) {
      const index = next++;
      const config = race.contestants[index]!;
      let contestant: Contestant;
      try {
        contestant = opts.createContestant(config);
      } catch (err) {
        contestant = {
          kind: "llm",
          complete: () => Promise.reject(err instanceof Error ? err : new Error(String(err))),
        };
      }
      results[index] = await runContestant({ contestant, config, initialState, signal: opts.signal, emit });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, race.contestants.length) }, worker));
  emit({ type: "race_finished", raceId: race.id, status: opts.signal.aborted ? "cancelled" : "finished" });
  return results;
}

/** Ranking: solved first, then higher progress, then lower wall time. */
export function rankResults(results: readonly RunResult[]): RunResult[] {
  return [...results].sort(
    (a, b) => Number(b.solved) - Number(a.solved) || b.progress - a.progress || a.wallMs - b.wallMs,
  );
}
