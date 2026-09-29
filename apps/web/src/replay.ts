import type { TurnRecord } from "@rubik-arena/bench-core";
import type { Move } from "@rubik-arena/cube-engine";

/**
 * Replay of a finished run. A lane's moves are laid on the race timeline: every move of turn k is placed at the
 * moment that turn's answer arrived (turn start + latency), so "real time" replay shows who was faster.
 */
export type ReplayMode = "moves" | "time";

export interface LaneTimeline {
  moves: Move[];
  /** Race time (ms since run start) at which move i was applied. Non-decreasing. */
  at: number[];
  /** Index into `turns` for move i. */
  turnOf: number[];
  /** First move index of each turn (turns with no applied moves point at the next move). */
  turnStart: number[];
  /** Total run time (ms); replay in time mode ends here. */
  durationMs: number;
}

export interface TimelineSource {
  turns: readonly TurnRecord[];
  movesApplied: readonly Move[];
  wallMs?: number;
}

export function buildTimeline(src: TimelineSource): LaneTimeline {
  const moves: Move[] = [];
  const at: number[] = [];
  const turnOf: number[] = [];
  const turnStart: number[] = [];
  src.turns.forEach((t, k) => {
    turnStart.push(moves.length);
    const when = t.startedAtMs + t.latencyMs;
    for (const m of t.moves) {
      moves.push(m);
      at.push(when);
      turnOf.push(k);
    }
  });
  const lastTurnEnd = src.turns.length ? Math.max(...src.turns.map((t) => t.startedAtMs + t.latencyMs)) : 0;
  const durationMs = Math.max(src.wallMs ?? 0, lastTurnEnd, 1);

  // Turn records and the final move list should agree; if not, trust the final list and spread it evenly.
  const same = moves.length === src.movesApplied.length && moves.every((m, i) => m === src.movesApplied[i]);
  if (!same) {
    const n = src.movesApplied.length;
    return {
      moves: [...src.movesApplied],
      at: src.movesApplied.map((_, i) => Math.round(((i + 1) / Math.max(1, n)) * durationMs)),
      turnOf: src.movesApplied.map(() => 0),
      turnStart: [0],
      durationMs,
    };
  }
  return { moves, at, turnOf, turnStart, durationMs };
}

/** Number of moves applied at or before race time `ms`. */
export function positionAt(tl: LaneTimeline, ms: number): number {
  let lo = 0;
  let hi = tl.at.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tl.at[mid]! <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Race time at which the first `pos` moves have been applied. */
export function timeOf(tl: LaneTimeline, pos: number): number {
  if (pos <= 0) return 0;
  return tl.at[Math.min(pos, tl.at.length) - 1] ?? 0;
}

/** Index of the last turn that is fully shown at `pos`, or -1 before the first turn completes. */
export function completedTurn(tl: LaneTimeline, pos: number): number {
  let k = -1;
  for (let t = 0; t < tl.turnStart.length; t++) {
    const next = tl.turnStart[t + 1] ?? tl.moves.length;
    if (next <= pos) k = t;
    else break;
  }
  return k;
}

export interface LaneCursor {
  /** Moves shown; fractional while playing in move mode. Display with Math.floor. */
  pos: number;
  /** Race time shown (ms). */
  clock: number;
  playing: boolean;
}

export interface ReplayState {
  mode: ReplayMode;
  /** Moves per second in move mode. */
  movesPerSecond: number;
  /** Time multiplier in time mode (e.g. 30 = 30× faster than the real race). */
  timeScale: number;
  timelines: Record<string, LaneTimeline>;
  cursors: Record<string, LaneCursor>;
}

export type ReplayAction =
  | { type: "open"; timelines: Record<string, LaneTimeline>; play?: string[] | "all" }
  | { type: "close" }
  | { type: "toggle"; id: string }
  | { type: "play"; ids: string[] | "all"; restart?: boolean }
  | { type: "pause"; ids: string[] | "all" }
  | { type: "seek"; id: string; pos: number }
  | { type: "step"; id: string; delta: number }
  | { type: "tick"; dtMs: number }
  | { type: "mode"; mode: ReplayMode }
  | { type: "speed"; movesPerSecond?: number; timeScale?: number };

export const MOVE_SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;
export const TIME_SCALES = [1, 5, 15, 30, 60, 120, 300] as const;

const atEnd = (tl: LaneTimeline, c: LaneCursor, mode: ReplayMode) =>
  mode === "moves" ? Math.floor(c.pos) >= tl.moves.length : c.clock >= tl.durationMs;

const endCursor = (tl: LaneTimeline): LaneCursor => ({
  pos: tl.moves.length,
  clock: tl.durationMs,
  playing: false,
});

function seekCursor(tl: LaneTimeline, pos: number, playing: boolean): LaneCursor {
  const p = Math.max(0, Math.min(tl.moves.length, Math.round(pos)));
  return { pos: p, clock: timeOf(tl, p), playing };
}

function mapIds(
  state: ReplayState,
  ids: string[] | "all",
  fn: (tl: LaneTimeline, c: LaneCursor) => LaneCursor,
) {
  const targets = ids === "all" ? Object.keys(state.cursors) : ids;
  const cursors = { ...state.cursors };
  for (const id of targets) {
    const tl = state.timelines[id];
    const c = cursors[id];
    if (tl && c) cursors[id] = fn(tl, c);
  }
  return { ...state, cursors };
}

export function openReplay(
  timelines: Record<string, LaneTimeline>,
  prev?: Partial<ReplayState>,
): ReplayState {
  const cursors: Record<string, LaneCursor> = {};
  for (const [id, tl] of Object.entries(timelines)) cursors[id] = endCursor(tl);
  return {
    mode: prev?.mode ?? "time",
    movesPerSecond: prev?.movesPerSecond ?? 2,
    timeScale: prev?.timeScale ?? 30,
    timelines,
    cursors,
  };
}

/** Pure replay reducer. `null` means "not replaying" (live/final view). */
export function replayReducer(state: ReplayState | null, action: ReplayAction): ReplayState | null {
  if (action.type === "open") {
    const opened = openReplay(action.timelines, state ?? undefined);
    return action.play ? replayReducer(opened, { type: "play", ids: action.play, restart: true }) : opened;
  }
  if (!state) return null;
  switch (action.type) {
    case "close":
      return null;
    case "play":
      return mapIds(state, action.ids, (tl, c) =>
        action.restart || atEnd(tl, c, state.mode)
          ? { pos: 0, clock: 0, playing: true }
          : { ...c, playing: true },
      );
    case "pause":
      return mapIds(state, action.ids, (_, c) => ({ ...c, playing: false }));
    case "toggle": {
      const c = state.cursors[action.id];
      if (!c) return state;
      return replayReducer(state, { type: c.playing ? "pause" : "play", ids: [action.id] });
    }
    case "seek":
      return mapIds(state, [action.id], (tl, c) => seekCursor(tl, action.pos, c.playing));
    case "step":
      return mapIds(state, [action.id], (tl, c) => seekCursor(tl, Math.floor(c.pos) + action.delta, false));
    case "mode":
      // Keep positions; re-derive clocks so both modes agree on where each lane is.
      return {
        ...mapIds(state, "all", (tl, c) => seekCursor(tl, Math.floor(c.pos), c.playing)),
        mode: action.mode,
      };
    case "speed":
      return {
        ...state,
        movesPerSecond: action.movesPerSecond ?? state.movesPerSecond,
        timeScale: action.timeScale ?? state.timeScale,
      };
    case "tick": {
      if (!Object.values(state.cursors).some((c) => c.playing)) return state;
      return mapIds(state, "all", (tl, c) => {
        if (!c.playing) return c;
        if (state.mode === "moves") {
          const pos = Math.min(tl.moves.length, c.pos + (action.dtMs / 1000) * state.movesPerSecond);
          const done = pos >= tl.moves.length;
          return { pos, clock: timeOf(tl, Math.floor(pos)), playing: !done };
        }
        const clock = Math.min(tl.durationMs, c.clock + action.dtMs * state.timeScale);
        return { pos: positionAt(tl, clock), clock, playing: clock < tl.durationMs };
      });
    }
  }
}

export function anyPlaying(state: ReplayState | null): boolean {
  return !!state && Object.values(state.cursors).some((c) => c.playing);
}
