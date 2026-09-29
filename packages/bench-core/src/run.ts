import {
  applyMoves,
  type CubeState,
  type Distance,
  distanceToSolved,
  formatMoves,
  isSolved,
  type Move,
} from "@rubik-arena/cube-engine";
import { parseResponse } from "./parse.ts";
import { PROMPT_VERSION, systemPrompt, userPrompt } from "./prompt.ts";
import type {
  Contestant,
  ContestantConfig,
  Cost,
  RunEvent,
  RunResult,
  RunStatus,
  TurnRecord,
  Usage,
} from "./types.ts";

/** Hard cap on moves accepted in one-shot mode. */
export const ONE_SHOT_MOVE_CAP = 300;
/** Interactive runs stop after this many invalid answers in a row. */
export const MAX_CONSECUTIVE_INVALID = 3;

export class TimeoutError extends Error {
  constructor(message = "timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export interface RunOptions {
  contestant: Contestant;
  config: ContestantConfig;
  initialState: CubeState;
  signal: AbortSignal;
  emit?: (event: RunEvent) => void;
}

function addCost(list: Cost[], cost: Cost | undefined): void {
  if (!cost) return;
  const existing = list.find((c) => c.unit === cost.unit);
  if (existing) existing.value += cost.value;
  else list.push({ ...cost });
}

const better = (a: Distance, b: Distance) => (a.value < b.value ? a : b);

/** Race a promise against an abort signal and a timeout. */
async function guarded<T>(work: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(parent.reason);
  parent.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new TimeoutError(`request exceeded ${timeoutMs} ms`);
      ctrl.abort(err);
      reject(err);
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (parent.aborted) reject(parent.reason);
    parent.addEventListener("abort", () => reject(parent.reason), { once: true });
  });
  try {
    return await Promise.race([work(ctrl.signal), timeout, aborted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onAbort);
  }
}

export async function runContestant(opts: RunOptions): Promise<RunResult> {
  const { contestant, config, initialState, emit = () => {} } = opts;
  const id = config.id;
  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);

  // Whole-run deadline, linked to the external (cancel) signal.
  const runCtrl = new AbortController();
  const onExternalAbort = () => runCtrl.abort(opts.signal.reason ?? new Error("cancelled"));
  if (opts.signal.aborted) onExternalAbort();
  opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  const runTimer = setTimeout(
    () => runCtrl.abort(new TimeoutError(`run exceeded ${config.runTimeoutMs} ms`)),
    config.runTimeoutMs,
  );

  const initialDistance = distanceToSolved(initialState);
  let state = initialState;
  let best = initialDistance;
  const turns: TurnRecord[] = [];
  const movesApplied: Move[] = [];
  const cost: Cost[] = [];
  const usage: Required<Usage> = { tokensIn: 0, tokensOut: 0 };
  let invalidOutputs = 0;
  let consecutiveInvalid = 0;
  let feedback: string | undefined;
  let status: RunStatus = "running";
  let error: string | undefined;
  let reportedModel: string | undefined;
  let meta: Record<string, unknown> | undefined;
  const startedAt = new Date().toISOString();

  emit({ type: "run_started", contestantId: id, at: startedAt });

  const oneShot = config.mode === "one-shot" && contestant.kind === "llm";
  const maxTurns = oneShot ? 1 : config.maxTurns;
  const maxMoves = config.mode === "one-shot" ? ONE_SHOT_MOVE_CAP : config.maxMovesPerTurn;

  try {
    for (let turn = 1; turn <= maxTurns && !isSolved(state); turn++) {
      if (runCtrl.signal.aborted) throw runCtrl.signal.reason;
      const turnStart = elapsed();
      const tTurn = performance.now();
      emit({ type: "turn_started", contestantId: id, turn, elapsedMs: turnStart });

      let rawText = "";
      let ttftMs: number | undefined;
      let parsed: ReturnType<typeof parseResponse>;
      let turnUsage: Usage | undefined;
      let turnCost: Cost | undefined;

      if (contestant.kind === "solver") {
        const moves = await guarded(
          (s) => contestant.nextMoves(state, s),
          runCtrl.signal,
          config.requestTimeoutMs,
        );
        rawText = JSON.stringify({ moves });
        // Solvers see the true state; per-turn caps only apply to LLM answers.
        parsed = { ok: true, moves: moves.slice(0, ONE_SHOT_MOVE_CAP) };
      } else {
        const response = await guarded(
          (signal) =>
            contestant.complete({
              system: systemPrompt(config.mode, config.maxMovesPerTurn),
              user: userPrompt(config.mode, { state, turn, maxTurns, history: movesApplied, feedback }),
              signal,
              timeoutMs: config.requestTimeoutMs,
              onFirstToken: () => {
                if (ttftMs !== undefined) return;
                ttftMs = Math.round(performance.now() - tTurn);
                emit({ type: "first_token", contestantId: id, turn, ttftMs });
              },
            }),
          runCtrl.signal,
          config.requestTimeoutMs,
        );
        rawText = response.text;
        turnUsage = response.usage;
        turnCost = response.cost;
        reportedModel = response.model ?? reportedModel;
        if (response.meta) meta = { ...meta, ...response.meta };
        parsed = parseResponse(rawText, maxMoves);
      }

      const latencyMs = Math.round(performance.now() - tTurn);
      usage.tokensIn += turnUsage?.tokensIn ?? 0;
      usage.tokensOut += turnUsage?.tokensOut ?? 0;
      addCost(cost, turnCost);

      if (parsed.ok) {
        state = applyMoves(state, parsed.moves);
        movesApplied.push(...parsed.moves);
        consecutiveInvalid = 0;
        feedback = parsed.moves.length
          ? `your ${parsed.moves.length} move(s) ${formatMoves(parsed.moves)} were applied.`
          : "you returned no moves.";
      } else {
        invalidOutputs++;
        consecutiveInvalid++;
        feedback = `your previous answer was invalid (${parsed.error}); no moves were applied.`;
      }

      const distanceAfter = isSolved(state)
        ? { value: 0, exact: true }
        : distanceToSolved(state, { mode: "fast" });
      best = better(best, distanceAfter);
      const record: TurnRecord = {
        turn,
        startedAtMs: turnStart,
        latencyMs,
        ttftMs,
        rawText: rawText.slice(0, 20_000),
        moves: parsed.ok ? parsed.moves : [],
        valid: parsed.ok,
        error: parsed.ok ? undefined : parsed.error,
        distanceAfter,
        usage: turnUsage,
        cost: turnCost,
      };
      turns.push(record);
      emit({ type: "turn_finished", contestantId: id, record, state, elapsedMs: elapsed() });

      if (!parsed.ok && consecutiveInvalid >= MAX_CONSECUTIVE_INVALID) {
        error = `stopped after ${MAX_CONSECUTIVE_INVALID} consecutive invalid answers`;
        break;
      }
    }
    status = isSolved(state) ? "solved" : "unsolved";
    if (status === "unsolved" && !error && oneShot && turns[0] && !turns[0].valid) error = turns[0].error;
  } catch (err) {
    if (err instanceof TimeoutError) status = "timeout";
    else if (opts.signal.aborted) status = "cancelled";
    else status = "error";
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(runTimer);
    opts.signal.removeEventListener("abort", onExternalAbort);
  }

  const solved = isSolved(state);
  const finalDistance = solved ? { value: 0, exact: true } : distanceToSolved(state);
  best = better(best, finalDistance);
  const progress =
    initialDistance.value === 0
      ? 1
      : Math.max(0, (initialDistance.value - best.value) / initialDistance.value);

  const result: RunResult = {
    contestantId: id,
    label: config.label,
    adapter: config.adapter,
    model: config.model,
    reportedModel,
    thinking: config.thinking,
    mode: config.mode,
    promptVersion: PROMPT_VERSION,
    status: solved ? "solved" : status,
    solved,
    startedAt,
    wallMs: elapsed(),
    turns,
    movesApplied,
    invalidOutputs,
    initialDistance,
    bestDistance: best,
    finalDistance,
    progress: Math.round(progress * 1000) / 1000,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    cost,
    finalState: state,
    error,
    meta,
  };
  emit({ type: "run_finished", contestantId: id, result });
  return result;
}
