import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContestant } from "@rubik-arena/adapters";
import type { Contestant, ContestantConfig, RaceEvent } from "@rubik-arena/bench-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer, type RunnerServer } from "../src/index.ts";

const PORT = 8799;
const TOKEN = "test-token-abc";
const H = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };

let dir: string;
let srv: RunnerServer;

const baseline = (id: string, adapter = "kociemba") => ({ id, label: id, adapter, mode: "interactive" });

async function make(factory?: (c: ContestantConfig) => Contestant) {
  srv = await buildServer({
    token: TOKEN,
    port: PORT,
    dataDir: dir,
    createContestant: factory ?? createContestant,
  });
  return srv.app;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ra-runner-"));
});
afterEach(async () => {
  await srv?.races.cancelAll();
  await srv?.app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("security", () => {
  it("health is open, everything else needs the token", async () => {
    const app = await make();
    expect((await app.inject({ url: "/api/health", headers: { host: H.host } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/races", headers: { host: H.host } })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: "/api/races", headers: { host: H.host, authorization: "Bearer wrong" } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ url: "/api/races", headers: H })).statusCode).toBe(200);
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    const app = await make();
    const r = await app.inject({ url: "/api/health", headers: { host: "evil.example:8799" } });
    expect(r.statusCode).toBe(403);
    expect(
      (await app.inject({ url: "/api/health", headers: { host: `localhost:${PORT}` } })).statusCode,
    ).toBe(200);
  });

  it("sends no CORS headers and sets a CSP", async () => {
    const app = await make();
    const r = await app.inject({
      url: "/api/health",
      headers: { host: H.host, origin: "https://evil.example" },
    });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("refuses secrets in contestant options", async () => {
    const app = await make();
    const r = await app.inject({
      method: "POST",
      url: "/api/races",
      headers: H,
      payload: {
        contestants: [{ ...baseline("a", "openai-compatible"), model: "m", options: { apiKey: "sk-123" } }],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain("secrets are not accepted");
  });

  it("validates adapters, ids and model strings", async () => {
    const app = await make();
    const post = (contestants: unknown[]) =>
      app.inject({ method: "POST", url: "/api/races", headers: H, payload: { contestants } });
    expect((await post([baseline("a", "nope")])).statusCode).toBe(400);
    expect((await post([baseline("a"), baseline("a")])).statusCode).toBe(400);
    expect((await post([{ ...baseline("a", "pi"), model: "kiro/x; rm -rf /" }])).statusCode).toBe(400);
    expect((await post([{ ...baseline("../../etc") }])).statusCode).toBe(400);
  });

  it("race ids from the URL cannot traverse paths", async () => {
    const app = await make();
    const r = await app.inject({ url: "/api/races/..%2F..%2Fetc%2Fpasswd", headers: H });
    expect(r.statusCode).toBe(404);
  });
});

describe("race lifecycle", () => {
  it("runs baselines, streams events, persists and lists the result", async () => {
    const app = await make();
    const created = await app.inject({
      method: "POST",
      url: "/api/races",
      headers: H,
      payload: {
        scramble: { seed: 5, depth: 12 },
        concurrency: 2,
        contestants: [baseline("koc"), { ...baseline("rnd", "random"), maxTurns: 2 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const { id, race } = created.json();
    expect(race.scramble.moves).toHaveLength(12);
    await srv.races.waitFor(id);

    const rec = (await app.inject({ url: `/api/races/${id}`, headers: H })).json();
    expect(rec.status).toBe("finished");
    expect(rec.results[0].contestantId).toBe("koc");
    expect(rec.results[0].solved).toBe(true);
    expect(rec.results[1].solved).toBe(false);

    const sse = await app.inject({ url: `/api/races/${id}/events`, headers: H });
    expect(sse.headers["content-type"]).toBe("text/event-stream");
    const events = sse.body
      .split("\n\n")
      .filter((b) => b.startsWith("data: "))
      .map((b) => JSON.parse(b.slice(6)) as RaceEvent);
    expect(events[0]!.type).toBe("race_started");
    expect(events.at(-1)!.type).toBe("race_finished");
    expect(events.filter((e) => e.type === "run_finished")).toHaveLength(2);

    const list = (await app.inject({ url: "/api/races", headers: H })).json();
    expect(list.races[0].id).toBe(id);
    expect(list.races[0].contestants[0]).toMatchObject({ label: "koc", solved: true });
  });

  it("cancel stops a running LLM contestant", async () => {
    const hanging: Contestant = {
      kind: "llm",
      complete: (req) =>
        new Promise((_, rej) => req.signal.addEventListener("abort", () => rej(new Error("aborted")))),
    };
    const app = await make(() => hanging);
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/races",
        headers: H,
        payload: { contestants: [{ ...baseline("x", "pi"), model: "kiro/m" }] },
      })
    ).json();
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (await app.inject({ method: "POST", url: `/api/races/${id}/cancel`, headers: H })).statusCode,
    ).toBe(200);
    await srv.races.waitFor(id);
    const rec = (await app.inject({ url: `/api/races/${id}`, headers: H })).json();
    expect(rec.status).toBe("cancelled");
    expect(rec.results[0].status).toBe("cancelled");
  });

  it("marks races left running by a crash as interrupted", async () => {
    const app = await make();
    await srv.store.save({
      race: {
        id: "old",
        createdAt: "2026-01-01T00:00:00Z",
        scramble: { seed: 1, depth: 0, moves: [] },
        concurrency: 1,
        contestants: [],
      },
      initialState: "",
      status: "running",
      events: [],
      results: [],
    });
    expect(await srv.store.markInterrupted()).toBe(1);
    expect((await app.inject({ url: "/api/races/old", headers: H })).json().status).toBe("interrupted");
  });
});
