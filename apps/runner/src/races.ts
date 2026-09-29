import { randomUUID } from "node:crypto";
import {
  type Contestant,
  type ContestantConfig,
  initialStateOf,
  type RaceConfig,
  type RaceEvent,
  type RunResult,
  rankResults,
  runRace,
} from "@rubik-arena/bench-core";
import { scramble as makeScramble } from "@rubik-arena/cube-engine";
import type { CreateRaceInput } from "./schema.ts";
import type { RaceRecord, RaceStore } from "./store.ts";

type Listener = (event: RaceEvent) => void;

interface LiveRace {
  record: RaceRecord;
  controller: AbortController;
  listeners: Set<Listener>;
  done: Promise<void>;
}

export class RaceManager {
  private readonly live = new Map<string, LiveRace>();

  constructor(
    private readonly store: RaceStore,
    private readonly createContestant: (config: ContestantConfig) => Contestant,
  ) {}

  start(input: CreateRaceInput): RaceRecord {
    const { seed, depth } = input.scramble;
    const moves = input.scramble.moves?.length ? input.scramble.moves : makeScramble(seed, depth);
    const race: RaceConfig = {
      id: `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      scramble: { seed, depth: moves.length, moves },
      concurrency: input.concurrency,
      contestants: input.contestants as ContestantConfig[],
    };
    const record: RaceRecord = {
      race,
      initialState: initialStateOf(race),
      status: "running",
      events: [],
      results: [],
    };
    const controller = new AbortController();
    const live: LiveRace = { record, controller, listeners: new Set(), done: Promise.resolve() };
    this.live.set(race.id, live);

    const emit = (event: RaceEvent) => {
      // Keep streaming deltas small; full results are in run_finished.
      record.events.push(event);
      if (event.type === "run_finished") record.results.push(event.result);
      for (const l of live.listeners) l(event);
    };

    live.done = (async () => {
      await this.store.save(record);
      try {
        const results = await runRace({
          race,
          createContestant: this.createContestant,
          signal: controller.signal,
          emit,
        });
        record.results = rankResults(results);
        record.status = controller.signal.aborted ? "cancelled" : "finished";
      } catch (err) {
        record.status = "error";
        record.error = err instanceof Error ? err.message : String(err);
      } finally {
        record.finishedAt = new Date().toISOString();
        await this.store.save(record);
        this.live.delete(race.id);
        for (const l of live.listeners)
          l({
            type: "race_finished",
            raceId: race.id,
            status: record.status === "cancelled" ? "cancelled" : "finished",
          });
        live.listeners.clear();
      }
    })();
    return record;
  }

  /** Subscribe to a race; returns past events for replay and an unsubscribe function. */
  subscribe(
    id: string,
    listener: Listener,
  ): { past: RaceEvent[]; live: boolean; unsubscribe: () => void } | null {
    const live = this.live.get(id);
    if (!live) return null;
    live.listeners.add(listener);
    return { past: [...live.record.events], live: true, unsubscribe: () => live.listeners.delete(listener) };
  }

  get(id: string): RaceRecord | undefined {
    return this.live.get(id)?.record;
  }

  cancel(id: string): boolean {
    const live = this.live.get(id);
    if (!live) return false;
    live.controller.abort(new Error("cancelled by user"));
    return true;
  }

  async cancelAll(): Promise<void> {
    for (const l of this.live.values()) l.controller.abort(new Error("runner shutting down"));
    await Promise.all([...this.live.values()].map((l) => l.done));
  }

  async waitFor(id: string): Promise<void> {
    await this.live.get(id)?.done;
  }
}

export type { RunResult };
