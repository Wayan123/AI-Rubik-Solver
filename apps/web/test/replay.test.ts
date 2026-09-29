import type { TurnRecord } from "@rubik-arena/bench-core";
import type { Move } from "@rubik-arena/cube-engine";
import { describe, expect, it } from "vitest";
import {
  anyPlaying,
  buildTimeline,
  completedTurn,
  type LaneTimeline,
  positionAt,
  type ReplayState,
  replayReducer,
  timeOf,
} from "../src/replay.ts";

const turn = (startedAtMs: number, latencyMs: number, moves: Move[], valid = true): TurnRecord => ({
  turn: 0,
  startedAtMs,
  latencyMs,
  rawText: "",
  moves,
  valid,
  distanceAfter: { value: 0, exact: true },
});

// Turn 1 answers at 1000 ms with 2 moves, turn 2 is invalid at 3000 ms, turn 3 answers at 6000 ms with 3 moves.
const src = {
  turns: [turn(0, 1000, ["R", "U"]), turn(1000, 2000, [], false), turn(3000, 3000, ["F", "L'", "D2"])],
  movesApplied: ["R", "U", "F", "L'", "D2"] as Move[],
  wallMs: 6100,
};

describe("buildTimeline", () => {
  it("places moves at the moment their turn answered", () => {
    const tl = buildTimeline(src);
    expect(tl.moves).toEqual(src.movesApplied);
    expect(tl.at).toEqual([1000, 1000, 6000, 6000, 6000]);
    expect(tl.turnOf).toEqual([0, 0, 2, 2, 2]);
    expect(tl.turnStart).toEqual([0, 2, 2]);
    expect(tl.durationMs).toBe(6100);
  });

  it("falls back to an even spread when turns and the final move list disagree", () => {
    const tl = buildTimeline({ ...src, movesApplied: ["R", "U", "F"] });
    expect(tl.moves).toEqual(["R", "U", "F"]);
    expect(tl.at).toEqual([2033, 4067, 6100]);
  });

  it("maps time ↔ position and completed turns", () => {
    const tl = buildTimeline(src);
    expect(positionAt(tl, 0)).toBe(0);
    expect(positionAt(tl, 999)).toBe(0);
    expect(positionAt(tl, 1000)).toBe(2);
    expect(positionAt(tl, 5999)).toBe(2);
    expect(positionAt(tl, 99_999)).toBe(5);
    expect(timeOf(tl, 0)).toBe(0);
    expect(timeOf(tl, 3)).toBe(6000);
    expect(completedTurn(tl, 0)).toBe(-1);
    expect(completedTurn(tl, 2)).toBe(1); // turn 2 (invalid) is complete as soon as turn 1 is
    expect(completedTurn(tl, 4)).toBe(1);
    expect(completedTurn(tl, 5)).toBe(2);
  });
});

describe("replayReducer", () => {
  const timelines: Record<string, LaneTimeline> = {
    a: buildTimeline(src),
    b: buildTimeline({ turns: [turn(0, 500, ["B"])], movesApplied: ["B"], wallMs: 500 }),
  };
  const open = (play?: string[] | "all") =>
    replayReducer(null, { type: "open", timelines, play }) as ReplayState;

  it("opens at the final position, paused", () => {
    const s = open();
    expect(s.cursors.a).toEqual({ pos: 5, clock: 6100, playing: false });
    expect(anyPlaying(s)).toBe(false);
  });

  it("replay all starts every lane from the beginning together", () => {
    const s = open("all");
    expect(s.cursors.a).toEqual({ pos: 0, clock: 0, playing: true });
    expect(s.cursors.b).toEqual({ pos: 0, clock: 0, playing: true });
  });

  it("time mode keeps lanes on the real race clock", () => {
    let s = open("all");
    s = replayReducer(s, { type: "speed", timeScale: 10 })!;
    s = replayReducer(s, { type: "tick", dtMs: 60 })!; // 600 ms of race time
    expect(s.cursors.a).toMatchObject({ pos: 0, clock: 600, playing: true });
    expect(s.cursors.b).toMatchObject({ pos: 1, clock: 500, playing: false }); // b finished at 500 ms
    s = replayReducer(s, { type: "tick", dtMs: 100 })!; // 1600 ms
    expect(s.cursors.a!.pos).toBe(2);
    s = replayReducer(s, { type: "tick", dtMs: 1000 })!;
    expect(s.cursors.a).toMatchObject({ pos: 5, playing: false });
    expect(anyPlaying(s)).toBe(false);
  });

  it("move mode advances every lane by the same number of moves", () => {
    let s = replayReducer(open("all"), { type: "mode", mode: "moves" })!;
    s = replayReducer(s, { type: "speed", movesPerSecond: 4 })!;
    s = replayReducer(s, { type: "tick", dtMs: 500 })!; // 2 moves
    expect(Math.floor(s.cursors.a!.pos)).toBe(2);
    expect(s.cursors.a!.clock).toBe(1000);
    expect(s.cursors.b).toMatchObject({ pos: 1, playing: false });
  });

  it("per-lane play, pause, step and seek", () => {
    let s = open();
    s = replayReducer(s, { type: "toggle", id: "a" })!; // at end → restarts
    expect(s.cursors.a).toEqual({ pos: 0, clock: 0, playing: true });
    expect(s.cursors.b!.playing).toBe(false);
    s = replayReducer(s, { type: "toggle", id: "a" })!;
    expect(s.cursors.a!.playing).toBe(false);
    s = replayReducer(s, { type: "step", id: "a", delta: 1 })!;
    s = replayReducer(s, { type: "step", id: "a", delta: 1 })!;
    s = replayReducer(s, { type: "step", id: "a", delta: 1 })!;
    expect(s.cursors.a).toEqual({ pos: 3, clock: 6000, playing: false });
    s = replayReducer(s, { type: "step", id: "a", delta: -5 })!;
    expect(s.cursors.a!.pos).toBe(0);
    s = replayReducer(s, { type: "seek", id: "a", pos: 99 })!;
    expect(s.cursors.a!.pos).toBe(5);
    s = replayReducer(s, { type: "play", ids: ["a"], restart: true })!;
    expect(s.cursors.a!.pos).toBe(0);
    s = replayReducer(s, { type: "pause", ids: "all" })!;
    expect(anyPlaying(s)).toBe(false);
    expect(replayReducer(s, { type: "close" })).toBeNull();
  });

  it("ignores unknown lanes and actions without an open replay", () => {
    expect(replayReducer(null, { type: "tick", dtMs: 100 })).toBeNull();
    const s = open();
    expect(replayReducer(s, { type: "toggle", id: "zzz" })).toBe(s);
    expect(replayReducer(s, { type: "tick", dtMs: 100 })).toBe(s);
  });
});
