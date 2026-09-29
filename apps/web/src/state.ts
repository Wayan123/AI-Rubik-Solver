import type {
  ContestantConfig,
  Cost,
  RaceConfig,
  RaceEvent,
  RunResult,
  RunStatus,
  TurnRecord,
} from "@rubik-arena/bench-core";
import { applyMoves, type CubeState, type Move } from "@rubik-arena/cube-engine";

/** Per-contestant live view derived from the event stream. */
export interface LaneState {
  config: ContestantConfig;
  status: RunStatus;
  state: CubeState;
  /** Moves not yet animated by the 3D cube (consumed by the view). */
  movesApplied: Move[];
  turns: TurnRecord[];
  /** Wall-clock (ms since epoch, client) when the run started, for the live timer. */
  startedAtClient?: number;
  /** Server-measured elapsed ms at the last event. */
  elapsedMs: number;
  currentTurn: number;
  waitingSinceClient?: number;
  lastTtftMs?: number;
  distance: number[];
  result?: RunResult;
}

export interface RaceView {
  race?: RaceConfig;
  initialState?: CubeState;
  lanes: Record<string, LaneState>;
  order: string[];
  status: "idle" | "running" | "finished" | "cancelled";
}

export const emptyView: RaceView = { lanes: {}, order: [], status: "idle" };

/** Pure reducer: fold a race event into the view. `now` is injected for testability. */
export function reduceRace(view: RaceView, event: RaceEvent, now: number): RaceView {
  switch (event.type) {
    case "race_started": {
      const lanes: Record<string, LaneState> = {};
      for (const c of event.race.contestants) {
        lanes[c.id] = {
          config: c,
          status: "pending",
          state: event.initialState,
          movesApplied: [],
          turns: [],
          elapsedMs: 0,
          currentTurn: 0,
          distance: [],
        };
      }
      return {
        race: event.race,
        initialState: event.initialState,
        lanes,
        order: event.race.contestants.map((c) => c.id),
        status: "running",
      };
    }
    case "race_finished":
      return { ...view, status: event.status === "cancelled" ? "cancelled" : "finished" };
    default: {
      const lane = view.lanes[event.contestantId];
      if (!lane) return view;
      const next: LaneState = { ...lane };
      if (event.type === "run_started") {
        next.status = "running";
        next.startedAtClient = now;
      } else if (event.type === "turn_started") {
        next.currentTurn = event.turn;
        next.elapsedMs = event.elapsedMs;
        next.waitingSinceClient = now;
        next.startedAtClient ??= now - event.elapsedMs;
      } else if (event.type === "first_token") {
        next.lastTtftMs = event.ttftMs;
      } else if (event.type === "turn_finished") {
        next.turns = [...lane.turns, event.record];
        next.movesApplied = [...lane.movesApplied, ...event.record.moves];
        next.state = event.state;
        next.elapsedMs = event.elapsedMs;
        next.waitingSinceClient = undefined;
        next.distance = [...lane.distance, event.record.distanceAfter.value];
      } else if (event.type === "run_finished") {
        next.result = event.result;
        next.status = event.result.status;
        next.elapsedMs = event.result.wallMs;
        next.state = event.result.finalState;
        next.waitingSinceClient = undefined;
        if (next.movesApplied.length !== event.result.movesApplied.length) {
          next.movesApplied = event.result.movesApplied;
        }
        if (!next.distance.length) next.distance = [event.result.finalDistance.value];
      }
      return { ...view, lanes: { ...view.lanes, [event.contestantId]: next } };
    }
  }
}

export function isLaneRunning(l: LaneState): boolean {
  return l.status === "running";
}

/** Live timer value for a lane. */
export function laneElapsedMs(l: LaneState, now: number): number {
  if (l.result) return l.result.wallMs;
  if (l.status === "running" && l.startedAtClient !== undefined)
    return Math.max(l.elapsedMs, now - l.startedAtClient);
  return l.elapsedMs;
}

/** Reconstruct the state after the first n applied moves (for replay scrubbing). */
export function stateAfter(initial: CubeState, moves: readonly Move[], n: number): CubeState {
  return applyMoves(initial, moves.slice(0, Math.max(0, Math.min(n, moves.length))));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
}

export function formatCost(cost: readonly Cost[]): string {
  return cost
    .map((c) => (c.unit === "USD" ? `$${c.value.toFixed(4)}` : `${c.value.toFixed(2)} ${c.unit}s`))
    .join(" · ");
}
