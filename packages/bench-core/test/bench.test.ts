import {
  applyMoves,
  formatMoves,
  invertMoves,
  type Move,
  parseMoves,
  SOLVED,
} from "@rubik-arena/cube-engine";
import { describe, expect, it } from "vitest";
import {
  type CompletionRequest,
  type ContestantConfig,
  type ModelClient,
  PROMPT_VERSION,
  parseResponse,
  type RaceConfig,
  type RunEvent,
  rankResults,
  runContestant,
  runRace,
  type Solver,
  systemPrompt,
  userPrompt,
} from "../src/index.ts";

const mv = (s: string) => {
  const r = parseMoves(s);
  if (!r.ok) throw new Error(r.error);
  return r.moves;
};

const config = (over: Partial<ContestantConfig> = {}): ContestantConfig => ({
  id: "c1",
  label: "fake",
  adapter: "fake",
  mode: "one-shot",
  maxTurns: 5,
  maxMovesPerTurn: 10,
  requestTimeoutMs: 2000,
  runTimeoutMs: 10_000,
  ...over,
});

/** Fake LLM that replies with scripted texts, one per call. */
function scripted(replies: Array<string | ((req: CompletionRequest) => Promise<string>)>): ModelClient & {
  calls: CompletionRequest[];
} {
  const calls: CompletionRequest[] = [];
  return {
    kind: "llm",
    calls,
    async complete(req) {
      calls.push(req);
      const r = replies[calls.length - 1] ?? '{"moves":[]}';
      const text = typeof r === "string" ? r : await r(req);
      req.onFirstToken?.();
      return {
        text,
        usage: { tokensIn: 10, tokensOut: 2 },
        cost: { value: 0.5, unit: "credit" },
        model: "fake-1",
      };
    },
  };
}

const scrambleMoves = mv("R U F' L2");
const start = applyMoves(SOLVED, scrambleMoves);
const solution = invertMoves(scrambleMoves);

describe("parseResponse", () => {
  it.each([
    ['{"moves":["R","U\'"]}', ["R", "U'"]],
    ['```json\n{"moves": ["F2"]}\n```', ["F2"]],
    ['I think {"moves":["R"]} is wrong. Final: {"moves":["L","D2"]}', ["L", "D2"]],
    ['{"moves":["R’","U2\'"]}', ["R'", "U2"]],
    ['{"note":"a } brace","moves":["B"]}', ["B"]],
  ])("accepts %s", (text, moves) => {
    expect(parseResponse(text, 10)).toEqual({ ok: true, moves });
  });
  it.each([
    ["no json here", "no JSON"],
    ['{"moves":"R U"}', "no JSON"],
    ['{"moves":["R","x"]}', "invalid move"],
    ['{"moves":["M"]}', "invalid move"],
    ['{"moves":["R","R","R"]}', "too many"],
  ])("rejects %s", (text, fragment) => {
    const r = parseResponse(text, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });
});

describe("prompts", () => {
  it("state and history are in the user prompt", () => {
    const p = userPrompt("interactive", {
      state: start,
      turn: 2,
      maxTurns: 30,
      history: ["R"],
      feedback: "ok",
    });
    expect(p).toContain(start);
    expect(p).toContain("Turn 2 of 30");
    expect(p).toContain("Moves applied so far (1): R");
    expect(p).toContain("Feedback on your previous answer: ok");
  });
  it("system prompt explains the protocol", () => {
    expect(systemPrompt("one-shot", 10)).toContain('{"moves"');
    expect(systemPrompt("interactive", 7)).toContain("1 to 7 moves");
  });
});

describe("runContestant", () => {
  it("one-shot: solves and records metrics", async () => {
    const client = scripted([JSON.stringify({ moves: solution })]);
    const events: RunEvent[] = [];
    const r = await runContestant({
      contestant: client,
      config: config(),
      initialState: start,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });
    expect(r.status).toBe("solved");
    expect(r.solved).toBe(true);
    expect(r.movesApplied).toEqual(solution);
    expect(r.initialDistance).toEqual({ value: 4, exact: true });
    expect(r.finalDistance.value).toBe(0);
    expect(r.progress).toBe(1);
    expect(r.tokensIn).toBe(10);
    expect(r.cost).toEqual([{ value: 0.5, unit: "credit" }]);
    expect(r.reportedModel).toBe("fake-1");
    expect(r.promptVersion).toBe(PROMPT_VERSION);
    expect(client.calls).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "turn_started",
      "first_token",
      "turn_finished",
      "run_finished",
    ]);
  });

  it("one-shot: wrong answer is unsolved with partial progress", async () => {
    const client = scripted([JSON.stringify({ moves: solution.slice(0, 2) })]);
    const r = await runContestant({
      contestant: client,
      config: config(),
      initialState: start,
      signal: new AbortController().signal,
    });
    expect(r.status).toBe("unsolved");
    expect(r.bestDistance.value).toBe(2);
    expect(r.progress).toBe(0.5);
  });

  it("interactive: solves over two turns and feeds state back", async () => {
    const client = scripted([
      JSON.stringify({ moves: solution.slice(0, 2) }),
      JSON.stringify({ moves: solution.slice(2) }),
    ]);
    const r = await runContestant({
      contestant: client,
      config: config({ mode: "interactive" }),
      initialState: start,
      signal: new AbortController().signal,
    });
    expect(r.status).toBe("solved");
    expect(r.turns).toHaveLength(2);
    expect(client.calls[1]!.user).toContain(`Moves applied so far (2): ${formatMoves(solution.slice(0, 2))}`);
    expect(r.tokensIn).toBe(20);
    expect(r.cost[0]!.value).toBe(1);
  });

  it("interactive: stops after 3 consecutive invalid answers", async () => {
    const client = scripted(["nope", '{"moves":["x"]}', "{}", '{"moves":["R"]}']);
    const r = await runContestant({
      contestant: client,
      config: config({ mode: "interactive", maxTurns: 10 }),
      initialState: start,
      signal: new AbortController().signal,
    });
    expect(client.calls).toHaveLength(3);
    expect(r.invalidOutputs).toBe(3);
    expect(r.status).toBe("unsolved");
    expect(r.error).toContain("3 consecutive invalid");
    expect(client.calls[1]!.user).toContain("invalid");
  });

  it("request timeout ends the run with status timeout", async () => {
    const client = scripted([
      (req) => new Promise((_, rej) => req.signal.addEventListener("abort", () => rej(req.signal.reason))),
    ]);
    const r = await runContestant({
      contestant: client,
      config: config({ requestTimeoutMs: 50 }),
      initialState: start,
      signal: new AbortController().signal,
    });
    expect(r.status).toBe("timeout");
    expect(r.error).toContain("50 ms");
  });

  it("cancel aborts the in-flight request", async () => {
    const ctrl = new AbortController();
    let sawAbort = false;
    const client = scripted([
      (req) =>
        new Promise((_, rej) =>
          req.signal.addEventListener("abort", () => {
            sawAbort = true;
            rej(new Error("aborted"));
          }),
        ),
    ]);
    const p = runContestant({
      contestant: client,
      config: config(),
      initialState: start,
      signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(new Error("cancelled by user")), 20);
    const r = await p;
    expect(r.status).toBe("cancelled");
    expect(sawAbort).toBe(true);
  });

  it("adapter error is reported, not thrown", async () => {
    const client: ModelClient = { kind: "llm", complete: () => Promise.reject(new Error("not logged in")) };
    const r = await runContestant({
      contestant: client,
      config: config(),
      initialState: start,
      signal: new AbortController().signal,
    });
    expect(r.status).toBe("error");
    expect(r.error).toBe("not logged in");
  });
});

describe("runRace", () => {
  it("solver baseline plays its full plan even with a small per-turn cap", async () => {
    const r = await runContestant({
      contestant: { kind: "solver", nextMoves: async () => solution },
      config: config({ mode: "interactive", maxMovesPerTurn: 1 }),
      initialState: start,
      signal: new AbortController().signal,
    });
    expect(r.status).toBe("solved");
    expect(r.turns).toHaveLength(1);
  });
  const solver: Solver = { kind: "solver", nextMoves: async () => solution };
  const race = (n: number, concurrency: number): RaceConfig => ({
    id: "r1",
    createdAt: new Date().toISOString(),
    scramble: { seed: 1, depth: 4, moves: scrambleMoves },
    concurrency,
    contestants: Array.from({ length: n }, (_, i) => config({ id: `c${i}`, label: `c${i}` })),
  });

  it("runs all contestants on the same scramble and keeps order", async () => {
    const events: string[] = [];
    const results = await runRace({
      race: race(3, 2),
      createContestant: (c) => (c.id === "c1" ? scripted(["garbage"]) : solver),
      signal: new AbortController().signal,
      emit: (e) => events.push(e.type),
    });
    expect(results.map((r) => r.contestantId)).toEqual(["c0", "c1", "c2"]);
    expect(results.map((r) => r.status)).toEqual(["solved", "unsolved", "solved"]);
    expect(events[0]).toBe("race_started");
    expect(events.at(-1)).toBe("race_finished");
    expect(rankResults(results).at(-1)!.contestantId).toBe("c1");
  });

  it("a contestant that fails to construct becomes an error result", async () => {
    const results = await runRace({
      race: race(1, 1),
      createContestant: () => {
        throw new Error("unknown adapter");
      },
      signal: new AbortController().signal,
    });
    expect(results[0]!.status).toBe("error");
    expect(results[0]!.error).toBe("unknown adapter");
  });
});

// Keep the Move type used (helps editors).
export type _M = Move;
