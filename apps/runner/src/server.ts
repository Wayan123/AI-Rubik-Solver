import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import fastifyStatic from "@fastify/static";
import {
  adapterInfos,
  createContestant as defaultCreateContestant,
  detectAdapters,
  hasAdapter,
  listModels,
} from "@rubik-arena/adapters";
import type { Contestant, ContestantConfig, RaceEvent } from "@rubik-arena/bench-core";
import Fastify, { type FastifyInstance } from "fastify";
import { hostAllowed, tokenMatches } from "./auth.ts";
import { RaceManager } from "./races.ts";
import { createRaceSchema } from "./schema.ts";
import { RaceStore } from "./store.ts";

export interface ServerOptions {
  token: string;
  port: number;
  dataDir: string;
  /** Built web app directory to serve at `/` (optional). */
  webDir?: string;
  presetsFile?: string;
  createContestant?: (config: ContestantConfig) => Contestant;
  logger?: boolean;
}

export interface RunnerServer {
  app: FastifyInstance;
  races: RaceManager;
  store: RaceStore;
}

export const VERSION = "0.1.0";

export async function buildServer(opts: ServerOptions): Promise<RunnerServer> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024 });
  const store = new RaceStore(opts.dataDir);
  const races = new RaceManager(store, opts.createContestant ?? defaultCreateContestant);

  // Security headers for everything we serve.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    return payload;
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!hostAllowed(req.headers.host, opts.port)) {
      return reply.code(403).send({ error: "forbidden host" });
    }
    if (!req.url.startsWith("/api/") || req.url === "/api/health") return;
    if (!tokenMatches(opts.token, req.headers.authorization)) {
      return reply.code(401).send({ error: "missing or invalid token" });
    }
  });

  app.get("/api/health", async () => ({ ok: true, name: "rubik-arena-runner", version: VERSION }));

  app.get("/api/adapters", async (req) => {
    const detect = (req.query as { detect?: string }).detect !== "0";
    return detect ? detectAdapters() : adapterInfos();
  });

  app.get<{ Params: { id: string }; Querystring: { search?: string } }>(
    "/api/adapters/:id/models",
    async (req, reply) => {
      if (!hasAdapter(req.params.id)) return reply.code(404).send({ error: "unknown adapter" });
      const search = req.query.search?.slice(0, 60);
      if (search && !/^[\w./:-]*$/.test(search)) return reply.code(400).send({ error: "invalid search" });
      try {
        return { models: await listModels(req.params.id, search) };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get("/api/presets", async () => {
    if (!opts.presetsFile || !existsSync(opts.presetsFile)) return { contestants: [] };
    return JSON.parse(await readFile(opts.presetsFile, "utf8"));
  });

  app.post("/api/races", async (req, reply) => {
    const parsed = createRaceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid race", issues: parsed.error.issues });
    const unknown = parsed.data.contestants.find((c) => !hasAdapter(c.adapter));
    if (unknown) return reply.code(400).send({ error: `unknown adapter "${unknown.adapter}"` });
    const record = races.start(parsed.data);
    return reply.code(201).send({ id: record.race.id, race: record.race, initialState: record.initialState });
  });

  app.get("/api/races", async () => ({ races: await store.list() }));

  app.get<{ Params: { id: string } }>("/api/races/:id", async (req, reply) => {
    const record = races.get(req.params.id) ?? (await store.load(req.params.id));
    if (!record) return reply.code(404).send({ error: "not found" });
    return record;
  });

  app.post<{ Params: { id: string } }>("/api/races/:id/cancel", async (req, reply) => {
    if (!races.cancel(req.params.id)) return reply.code(404).send({ error: "race is not running" });
    return { ok: true };
  });

  /** Server-sent events: replays the race so far, then streams live events. */
  app.get<{ Params: { id: string } }>("/api/races/:id/events", async (req, reply) => {
    const write = (event: RaceEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const open = () =>
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-content-type-options": "nosniff",
      });

    const sub = races.subscribe(req.params.id, (event) => {
      write(event);
      if (event.type === "race_finished") reply.raw.end();
    });
    if (sub) {
      reply.hijack();
      open();
      for (const e of sub.past) write(e);
      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
      req.raw.on("close", () => {
        clearInterval(ping);
        sub.unsubscribe();
      });
      return;
    }
    const record = await store.load(req.params.id);
    if (!record) return reply.code(404).send({ error: "not found" });
    reply.hijack();
    open();
    for (const e of record.events) write(e);
    if (!record.events.some((e) => e.type === "race_finished")) {
      write({
        type: "race_finished",
        raceId: record.race.id,
        status: record.status === "cancelled" ? "cancelled" : "finished",
      });
    }
    reply.raw.end();
  });

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, index: ["index.html"] });
  } else {
    app.get("/", async (_req, reply) =>
      reply
        .type("text/plain")
        .send(
          "Rubik Arena runner is up. Build the dashboard with `npm run build`, or run `npm run dev:web`.",
        ),
    );
  }

  return { app, races, store };
}
