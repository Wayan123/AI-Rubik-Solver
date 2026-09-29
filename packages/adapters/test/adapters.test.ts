import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContestantConfig } from "@rubik-arena/bench-core";
import { runContestant } from "@rubik-arena/bench-core";
import { applyMoves, SOLVED } from "@rubik-arena/cube-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adapterInfos,
  buildKiroArgs,
  buildPiArgs,
  createContestant,
  feedKiroLine,
  feedPiLine,
  KiroClient,
  kiroResponse,
  newKiroState,
  OpenAICompatibleClient,
  PiClient,
  parseKiroModelList,
  parsePiModelList,
  piResponse,
  resolveApiKey,
  resolveProviderExtensions,
  spawnCli,
} from "../src/index.ts";

const FIX = join(import.meta.dirname, "fixtures");
const FAKE = join(FIX, "fake-cli.mjs");
const req = { system: "SYS", user: "USER" };
const never = new AbortController().signal;
const DANGEROUS = ["--yolo", "--trust-all-tools", "-a", "--dangerously-skip-permissions", "--approve"];

describe("spawnCli", () => {
  it("streams stdout lines including a trailing partial line", async () => {
    const lines: string[] = [];
    const r = await spawnCli({
      command: process.execPath,
      args: [FAKE],
      env: { FAKE_MODE: "lines" },
      signal: never,
      timeoutMs: 5000,
      onLine: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(0);
    expect(lines).toEqual(["one", "two", "three"]);
  });

  it("runs in a fresh empty temp dir that is removed afterwards", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-test-"));
    const argsFile = join(dir, "args.json");
    await spawnCli({
      command: process.execPath,
      args: [FAKE],
      env: { FAKE_ARGS_FILE: argsFile },
      signal: never,
      timeoutMs: 5000,
    });
    const { cwd } = JSON.parse(await readFile(argsFile, "utf8"));
    expect(cwd).toContain("rubik-arena-");
    await expect(readFile(join(cwd, "x"))).rejects.toThrow();
    await rm(dir, { recursive: true });
  });

  it("passes argv without a shell (metacharacters stay literal)", async () => {
    const lines: string[] = [];
    await spawnCli({
      command: process.execPath,
      args: [FAKE, "$(whoami); rm -rf /", "`id`"],
      signal: never,
      timeoutMs: 5000,
      onLine: (l) => lines.push(l),
    });
    expect(JSON.parse(lines[0]!)).toEqual(["$(whoami); rm -rf /", "`id`"]);
  });

  it("kills the child on timeout", async () => {
    const t = performance.now();
    await expect(
      spawnCli({
        command: process.execPath,
        args: [FAKE],
        env: { FAKE_MODE: "hang" },
        signal: never,
        timeoutMs: 300,
      }),
    ).rejects.toThrow("exceeded 300 ms");
    expect(performance.now() - t).toBeLessThan(4000);
  });

  it("kills the child on abort", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error("cancelled")), 200);
    await expect(
      spawnCli({
        command: process.execPath,
        args: [FAKE],
        env: { FAKE_MODE: "hang" },
        signal: ctrl.signal,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("cancelled");
  });

  it("reports a missing binary clearly", async () => {
    await expect(
      spawnCli({ command: "definitely-not-a-cli-xyz", args: [], signal: never, timeoutMs: 1000 }),
    ).rejects.toThrow("not found on PATH");
  });
});

describe("pi adapter", () => {
  it("argv disables tools, skills, context, templates and user extensions", () => {
    const args = buildPiArgs(
      { model: "kiro/claude-opus-5-5", thinking: "high", extensions: ["/ext/kiro"] },
      req,
    );
    for (const flag of [
      "-p",
      "--no-session",
      "--no-tools",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-extensions",
    ]) {
      expect(args).toContain(flag);
    }
    for (const bad of DANGEROUS) expect(args).not.toContain(bad);
    expect(args.slice(args.indexOf("-e"), args.indexOf("-e") + 2)).toEqual(["-e", "/ext/kiro"]);
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
      "--model",
      "kiro/claude-opus-5-5",
    ]);
    expect(args.slice(args.indexOf("--thinking"), args.indexOf("--thinking") + 2)).toEqual([
      "--thinking",
      "high",
    ]);
    expect(args.at(-2)).toBe("SYS");
    expect(args.at(-1)).toBe("USER");
  });

  it("does not add extensions for built-in providers", () => {
    expect(resolveProviderExtensions("anthropic/claude-x")).toEqual([]);
  });

  it("parses the recorded Kiro/Opus 5.5 JSONL fixture", () => {
    const state = { text: "", sawDelta: false };
    let firsts = 0;
    for (const line of readFileSync(join(FIX, "pi-ok.jsonl"), "utf8").split("\n"))
      if (feedPiLine(state, line)) firsts++;
    expect(firsts).toBe(1);
    const r = piResponse(state);
    expect(r.text).toBe('{"moves":["R","U"]}');
    expect(r.model).toBe("kiro/claude-opus-5-5");
    expect(r.usage?.tokensIn).toBeGreaterThan(0);
    expect(r.usage?.tokensOut).toBeGreaterThan(0);
  });

  it("surfaces provider errors", () => {
    const state = { text: "", sawDelta: false };
    feedPiLine(
      state,
      JSON.stringify({
        type: "turn_end",
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "403 not authorized" },
      }),
    );
    expect(() => piResponse(state)).toThrow("403 not authorized");
  });

  it("fails when pi exits 0 without an assistant message", () => {
    expect(() => piResponse({ text: "", sawDelta: false })).toThrow("no assistant message");
  });

  it("rejects malformed model ids", () => {
    expect(() => new PiClient({ model: "no-provider" })).toThrow('"provider/model"');
    expect(() => new PiClient({ model: "kiro/x; rm -rf" })).toThrow();
  });

  it("parses `pi --list-models` table output", () => {
    const out =
      "provider  model              context\nkiro      claude-opus-5-5    1M\nkiro      gpt-5-6-sol  1M\n";
    expect(parsePiModelList(out)).toEqual(["kiro/claude-opus-5-5", "kiro/gpt-5-6-sol"]);
  });
});

describe("kiro-cli adapter", () => {
  it("argv uses engine v3 and trusts no tools", () => {
    const args = buildKiroArgs({ model: "claude-opus-5.5", effort: "high" }, req);
    expect(args.slice(0, 3)).toEqual(["chat", "--agent-engine", "v3"]);
    expect(args).toContain("--no-interactive");
    expect(args).toContain("--trust-tools=");
    for (const bad of DANGEROUS) expect(args).not.toContain(bad);
    expect(args.at(-1)).toContain("SYS");
    expect(args.at(-1)).toContain("USER");
  });

  it("parses the recorded v3 stream-json fixture", () => {
    const state = newKiroState();
    let firsts = 0;
    for (const line of readFileSync(join(FIX, "kiro-v3-ok.jsonl"), "utf8").split("\n"))
      if (feedKiroLine(state, line)) firsts++;
    expect(firsts).toBe(1);
    const r = kiroResponse(state, "claude-opus-5.5");
    expect(r.text).toBe('{"moves":["R","U"]}');
    expect(r.model).toBe("kiro/claude-opus-5.5");
    expect(r.cost?.unit).toBe("credit");
    expect(r.cost!.value).toBeGreaterThan(0);
    expect(r.meta).toEqual({ effectiveEffort: "medium" });
  });

  it("fails loudly when Kiro silently switches model", () => {
    const state = newKiroState();
    feedKiroLine(
      state,
      JSON.stringify({
        type: "sessionUpdate",
        data: {
          update: {
            sessionUpdate: "config_option_update",
            configOptions: [{ id: "model", currentValue: "auto" }],
          },
        },
      }),
    );
    feedKiroLine(
      state,
      JSON.stringify({ type: "runFinished", data: { status: "success", finalText: "{}" } }),
    );
    expect(() => kiroResponse(state, "claude-opus-5.5")).toThrow('used model "auto"');
  });

  it("parses --list-models json", () => {
    expect(parseKiroModelList('{"models":[{"model_id":"auto"},{"model_id":"claude-opus-5.5"}]}')).toEqual([
      "auto",
      "claude-opus-5.5",
    ]);
  });

  it("non-zero exit becomes a clear error with stderr (fake binary)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-fail-"));
    const { writeFile, chmod } = await import("node:fs/promises");
    const wrapper = join(dir, "kiro-cli");
    await writeFile(wrapper, `#!/bin/sh\nFAKE_MODE=fail exec '${process.execPath}' '${FAKE}' "$@"\n`);
    await chmod(wrapper, 0o755);
    const client = new KiroClient({ model: "claude-opus-5.5", bin: wrapper });
    await expect(client.complete({ ...req, signal: never, timeoutMs: 5000 })).rejects.toThrow(
      /exited with code 3: Error: not logged in/,
    );
    await rm(dir, { recursive: true });
  });
});

describe("fake CLI through a full run", () => {
  it("pi client + bench core solve with a fixture that contains the right answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-fix-"));
    const { writeFile, chmod } = await import("node:fs/promises");
    const fixture = readFileSync(join(FIX, "pi-ok.jsonl"), "utf8").replaceAll(
      '[\\"R\\",\\"U\\"]',
      '[\\"U\'\\",\\"R\'\\"]',
    );
    await writeFile(join(dir, "f.jsonl"), fixture);
    const wrapper = join(dir, "pi");
    await writeFile(
      wrapper,
      `#!/bin/sh\nFAKE_MODE=fixture FAKE_FIXTURE='${join(dir, "f.jsonl")}' exec '${process.execPath}' '${FAKE}' "$@"\n`,
    );
    await chmod(wrapper, 0o755);
    const config: ContestantConfig = {
      id: "pi",
      label: "pi fake",
      adapter: "pi",
      model: "kiro/claude-opus-5-5",
      thinking: "high",
      mode: "one-shot",
      maxTurns: 1,
      maxMovesPerTurn: 10,
      requestTimeoutMs: 10_000,
      runTimeoutMs: 20_000,
    };
    const client = new PiClient({ model: config.model!, thinking: "high", bin: wrapper, extensions: ["/x"] });
    const result = await runContestant({
      contestant: client,
      config,
      initialState: applyMoves(SOLVED, ["R", "U"]),
      signal: never,
    });
    expect(result.status).toBe("solved");
    expect(result.reportedModel).toBe("kiro/claude-opus-5-5");
    expect(result.turns[0]!.ttftMs).toBeGreaterThanOrEqual(0);
    await rm(dir, { recursive: true });
  });
});

describe("openai-compatible adapter", () => {
  let server: Server;
  let base = "";
  let lastAuth: string | undefined;
  let lastBody: Record<string, unknown> = {};
  beforeAll(async () => {
    server = createServer((rq, rs) => {
      let body = "";
      rq.on("data", (c) => (body += c));
      rq.on("end", () => {
        lastAuth = rq.headers.authorization;
        lastBody = JSON.parse(body);
        if (lastBody.model === "bad") {
          rs.writeHead(401).end('{"error":"invalid key"}');
          return;
        }
        rs.writeHead(200, { "content-type": "text/event-stream" });
        const send = (o: unknown) => rs.write(`data: ${JSON.stringify(o)}\n\n`);
        send({ model: "m-1", choices: [{ delta: { content: '{"moves":' } }] });
        send({ model: "m-1", choices: [{ delta: { content: '["R"]}' } }] });
        send({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } });
        rs.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`;
  });
  afterAll(() => server.close());

  it("streams text, usage and model; sends key from env var", async () => {
    process.env.RA_TEST_KEY = "sk-test-123";
    let first = 0;
    const client = new OpenAICompatibleClient({
      baseUrl: base,
      model: "m",
      apiKeyEnv: "RA_TEST_KEY",
      reasoningEffort: "high",
    });
    const r = await client.complete({ ...req, signal: never, timeoutMs: 5000, onFirstToken: () => first++ });
    expect(r).toEqual({ text: '{"moves":["R"]}', usage: { tokensIn: 12, tokensOut: 4 }, model: "m-1" });
    expect(first).toBe(1);
    expect(lastAuth).toBe("Bearer sk-test-123");
    expect(lastBody.reasoning_effort).toBe("high");
    expect(lastBody.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
    ]);
    delete process.env.RA_TEST_KEY;
  });

  it("HTTP errors are reported", async () => {
    const client = new OpenAICompatibleClient({ baseUrl: base, model: "bad" });
    await expect(client.complete({ ...req, signal: never, timeoutMs: 5000 })).rejects.toThrow("HTTP 401");
  });

  it("refuses plain http to remote hosts and literal keys as env names", () => {
    expect(() => new OpenAICompatibleClient({ baseUrl: "http://example.com/v1", model: "m" })).toThrow(
      "https",
    );
    expect(() => resolveApiKey("sk-abc123")).toThrow("env var name");
    expect(() => resolveApiKey("RA_MISSING_VAR_XYZ")).toThrow("not set");
  });
});

describe("registry", () => {
  it("lists the M1 adapters", () => {
    expect(adapterInfos().map((a) => a.id)).toEqual([
      "pi",
      "kiro-cli",
      "openai-compatible",
      "kociemba",
      "random",
    ]);
  });
  it("creates baselines and rejects unknown adapters", async () => {
    const base = {
      id: "k",
      label: "k",
      mode: "interactive",
      maxTurns: 1,
      maxMovesPerTurn: 10,
      requestTimeoutMs: 1000,
      runTimeoutMs: 1000,
    } as const;
    const k = createContestant({ ...base, adapter: "kociemba" });
    expect(k.kind).toBe("solver");
    expect(() => createContestant({ ...base, adapter: "nope" })).toThrow("unknown adapter");
    expect(() => createContestant({ ...base, adapter: "pi" })).toThrow("needs a model");
  });
});
