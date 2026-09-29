import type { CubeState, Distance, Move } from "@rubik-arena/cube-engine";

export type Mode = "one-shot" | "interactive";

export interface Usage {
  tokensIn?: number;
  tokensOut?: number;
}

export interface Cost {
  value: number;
  /** e.g. "USD", "credit" */
  unit: string;
}

export interface CompletionRequest {
  system: string;
  user: string;
  signal: AbortSignal;
  timeoutMs: number;
  /** Called once when the first output token/chunk arrives (for time-to-first-token). */
  onFirstToken?: () => void;
}

export interface CompletionResponse {
  text: string;
  usage?: Usage;
  cost?: Cost;
  /** Model identifier as reported by the provider/CLI, when available. */
  model?: string;
  /** Extra provider info (e.g. reported effort level). Must not contain secrets. */
  meta?: Record<string, unknown>;
}

/** Anything that can answer a prompt: CLI wrappers, HTTP APIs, fakes. */
export interface ModelClient {
  readonly kind: "llm";
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

/** Non-LLM baseline that sees the real state (e.g. Kociemba solver, random mover). */
export interface Solver {
  readonly kind: "solver";
  nextMoves(state: CubeState, signal: AbortSignal): Promise<Move[]>;
}

export type Contestant = ModelClient | Solver;

export interface ContestantConfig {
  id: string;
  label: string;
  adapter: string;
  model?: string;
  /** Thinking/effort level passed to the adapter (e.g. "high"). */
  thinking?: string;
  mode: Mode;
  maxTurns: number;
  maxMovesPerTurn: number;
  requestTimeoutMs: number;
  runTimeoutMs: number;
  /** Adapter-specific options (no secrets; API keys are referenced by env var name). */
  options?: Record<string, unknown>;
}

export interface ScrambleSpec {
  seed: number;
  depth: number;
  /** Explicit scramble; when set, seed/depth are informational only. */
  moves: Move[];
}

export interface RaceConfig {
  id: string;
  createdAt: string;
  scramble: ScrambleSpec;
  concurrency: number;
  contestants: ContestantConfig[];
}

export type RunStatus = "pending" | "running" | "solved" | "unsolved" | "error" | "timeout" | "cancelled";

export interface TurnRecord {
  turn: number;
  startedAtMs: number;
  latencyMs: number;
  ttftMs?: number;
  rawText: string;
  moves: Move[];
  valid: boolean;
  error?: string;
  distanceAfter: Distance;
  usage?: Usage;
  cost?: Cost;
}

export interface RunResult {
  contestantId: string;
  label: string;
  adapter: string;
  model?: string;
  reportedModel?: string;
  thinking?: string;
  mode: Mode;
  promptVersion: string;
  status: RunStatus;
  solved: boolean;
  startedAt?: string;
  wallMs: number;
  turns: TurnRecord[];
  movesApplied: Move[];
  invalidOutputs: number;
  initialDistance: Distance;
  bestDistance: Distance;
  finalDistance: Distance;
  /** (initial − best) / initial, in [0, 1]. */
  progress: number;
  tokensIn: number;
  tokensOut: number;
  cost: Cost[];
  finalState: CubeState;
  error?: string;
  meta?: Record<string, unknown>;
}

export type RunEvent =
  | { type: "run_started"; contestantId: string; at: string }
  | { type: "turn_started"; contestantId: string; turn: number; elapsedMs: number }
  | { type: "first_token"; contestantId: string; turn: number; ttftMs: number }
  | { type: "turn_finished"; contestantId: string; record: TurnRecord; state: CubeState; elapsedMs: number }
  | { type: "run_finished"; contestantId: string; result: RunResult };

export type RaceEvent =
  | { type: "race_started"; race: RaceConfig; initialState: CubeState }
  | RunEvent
  | { type: "race_finished"; raceId: string; status: "finished" | "cancelled" };
