import type { ContestantConfig, RaceEvent, RunResult, TurnRecord } from "@rubik-arena/bench-core";
import { applyMoves, SOLVED } from "@rubik-arena/cube-engine";
import { describe, expect, it } from "vitest";
import { emptyView, formatCost, formatDuration, laneElapsedMs, reduceRace } from "../src/state.ts";

const c: ContestantConfig = {
  id: "a",
  label: "A",
  adapter: "pi",
  mode: "interactive",
  maxTurns: 3,
  maxMovesPerTurn: 10,
  requestTimeoutMs: 1000,
  runTimeoutMs: 1000,
};
const start = applyMoves(SOLVED, ["R", "U"]);
const race = {
  id: "r",
  createdAt: "",
  scramble: { seed: 1, depth: 2, moves: ["R", "U"] as const },
  concurrency: 1,
  contestants: [c],
};

const turn = (moves: TurnRecord["moves"], d: number): TurnRecord => ({
  turn: 1,
  startedAtMs: 0,
  latencyMs: 900,
  ttftMs: 400,
  rawText: "{}",
  moves,
  valid: true,
  distanceAfter: { value: d, exact: true },
});

describe("reduceRace", () => {
  it("builds lanes and folds turns", () => {
    let v = reduceRace(
      emptyView,
      {
        type: "race_started",
        race: { ...race, scramble: { ...race.scramble, moves: ["R", "U"] } },
        initialState: start,
      },
      0,
    );
    expect(v.status).toBe("running");
    expect(v.lanes.a!.status).toBe("pending");
    v = reduceRace(v, { type: "run_started", contestantId: "a", at: "" }, 1000);
    v = reduceRace(v, { type: "turn_started", contestantId: "a", turn: 1, elapsedMs: 5 }, 1005);
    expect(v.lanes.a!.waitingSinceClient).toBe(1005);
    const after = applyMoves(start, ["U'"]);
    v = reduceRace(
      v,
      { type: "turn_finished", contestantId: "a", record: turn(["U'"], 1), state: after, elapsedMs: 910 },
      1910,
    );
    expect(v.lanes.a!.movesApplied).toEqual(["U'"]);
    expect(v.lanes.a!.state).toBe(after);
    expect(v.lanes.a!.distance).toEqual([1]);
    expect(v.lanes.a!.waitingSinceClient).toBeUndefined();
    expect(laneElapsedMs(v.lanes.a!, 3000)).toBe(2000);

    const result = {
      status: "solved",
      wallMs: 2500,
      finalState: SOLVED,
      movesApplied: ["U'", "R'"],
      finalDistance: { value: 0, exact: true },
    } as unknown as RunResult;
    v = reduceRace(v, { type: "run_finished", contestantId: "a", result }, 4000);
    expect(v.lanes.a!.status).toBe("solved");
    expect(laneElapsedMs(v.lanes.a!, 99_999)).toBe(2500);
    expect(v.lanes.a!.movesApplied).toEqual(["U'", "R'"]);
    v = reduceRace(v, { type: "race_finished", raceId: "r", status: "finished" }, 4001);
    expect(v.status).toBe("finished");
  });

  it("ignores events for unknown contestants", () => {
    const v = reduceRace(emptyView, { type: "run_started", contestantId: "zzz", at: "" } as RaceEvent, 0);
    expect(v).toBe(emptyView);
  });
});

describe("formatting", () => {
  it.each([
    [450, "450 ms"],
    [2300, "2.3 s"],
    [75_400, "1:15.4"],
  ])("formatDuration(%i) = %s", (ms, s) => expect(formatDuration(ms)).toBe(s));
  it("formats costs", () => {
    expect(formatCost([{ value: 0.35, unit: "credit" }])).toBe("0.35 credits");
    expect(formatCost([{ value: 0.0123, unit: "USD" }])).toBe("$0.0123");
  });
});
