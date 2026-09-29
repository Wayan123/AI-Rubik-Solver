# Rubik Arena M1 Implementation Plan

> **For agentic workers:** Execution method chosen: **Native** (implemented inline in this session, whole-branch
> review at the end). Steps use checkbox syntax for tracking.

**Goal:** Ship M1 of Rubik Arena: engine, bench core, adapters (pi, kiro-cli, openai-compatible, baselines),
local runner, 3D dashboard, docs, CI — verified with one real contestant (Pi → kiro/claude-opus-5-5, high).

**Architecture:** npm-workspace TypeScript monorepo; pure packages consumed from source by a Fastify runner and
a Vite/React/R3F web app. See spec §3.

**Tech Stack:** Node ≥22, TypeScript 5.9.3, Vitest 5.0.2, Biome 2.5.14, Vite 8.3.1, React 19.3.0,
three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, Fastify 5.12.5, zod 4.6.5, tsx 4.23.15,
cubejs 1.3.2 — all pinned exactly.

**Spec:** `docs/superpowers/specs/2026-09-29-rubik-arena-design.md`

## Global Constraints

- Exact dependency versions (no `^`/`~`).
- Move grammar: `U D L R F B` × {"", "'", "2"}; `’` → `'`, `2'` → `2`; anything else invalid.
- Facelet order `URFDLB`, 54 chars, cubejs-compatible.
- Runner binds 127.0.0.1; bearer token on `/api/*` except `/api/health`; Host guard; no CORS.
- CLI spawn: argv array, empty temp cwd, tools disabled, SIGTERM → SIGKILL after 5 s.
- Defaults: depth 20, maxTurns 30, maxMovesPerTurn 10, request timeout 600 s, run wall limit 1 800 s,
  one-shot cap 300 moves, 3 consecutive invalid outputs stop an interactive run, concurrency 1 (max 4).
- `PROMPT_VERSION = "v1"` stored in every result.

## Review Focus

- Model answers with prose + JSON, code fences or `R'2`-style tokens → parser must pick the last `moves`
  JSON and reject the whole answer on any bad token (bench-core parser tests).
- CLI prints auth/login errors and exits 0 with empty text → treated as `invalid_output`, not a crash
  (adapter tests with fake CLI).
- User cancels while a CLI child is running → child killed, run `cancelled`, other lanes stop (bench/runner tests).
- Browser opened without token or from a foreign Host → 401/403, no data leak (runner tests).
- Runner unreachable (static hosting) → demo mode with baselines only (web connection logic).

---

### Task 1: Scaffold + cube-engine
Files: root `package.json`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.nvmrc`,
`packages/cube-engine/src/{moves,cube,scramble,net,solver,index}.ts`, tests in `packages/cube-engine/test/`.
Produces: `SOLVED`, `Move`, `parseMoves(text) → {moves} | {error, token}`, `applyMove(s, m)`,
`applyMoves(s, ms)`, `isSolved(s)`, `invertMoves(ms)`, `scramble(seed, depth) → Move[]`, `renderNet(s)`,
`solve(s) → Move[]`, `kociembaDistance(s)`.
Tests: every move ×4 = identity; `R U R' U'` ×6 = identity; results equal cubejs for 200 random sequences;
scramble determinism + no same-face repeats; `solve(applyMoves(SOLVED, scramble))` solves.

### Task 2: bench-core
Files: `packages/bench-core/src/{types,prompt,parse,metrics,run,race,index}.ts` + tests.
Consumes Task 1. Produces `ModelClient`, `Solver`, `ContestantConfig`, `RaceConfig`, `RunEvent`, `RunResult`,
`buildPrompts`, `parseResponse`, `runContestant`, `runRace`, `PROMPT_VERSION`.
Tests: parser table; one-shot solve with fake client; interactive solve over 2 turns; 3 invalid → stop;
timeout; cancel; metrics (progress, bestDistance).

### Task 3: adapters
Files: `packages/adapters/src/{spawn,pi,kiro,openai,baselines,registry,index}.ts` + fixtures from probes.
Produces `createClient(contestant)`, `ADAPTERS` registry with `listModels`, `detect()`.
Tests: spawnCli with fake CLI (stream, timeout kill, exit code); pi/kiro JSONL fixture parsing; argv contains
tool-disabling flags and never `--yolo`/`--trust-all-tools`; openai-compatible against local http server.

### Task 4: runner
Files: `apps/runner/src/{server,auth,store,races,main}.ts` + tests.
Tests (Fastify inject): health open; 401 without token; 403 bad Host; race with baselines completes and is
persisted; SSE replay; cancel.

### Task 5: web dashboard
Files: `apps/web/src/**` (api client, demo engine, Cube3D, Lane, Leaderboard, ContestantEditor, History).
Tests: reducer for run events; token bootstrap from fragment. Browser check of a live baseline race.

### Task 6: docs, presets, CI, e2e, publish
Files: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `docs/adding-a-model.md`, `AGENTS.md`,
`docs/operations/PROJECT-MEMORY.md`, `config/contestants.json`, `.github/workflows/ci.yml`,
`scripts/e2e-pi.ts`. Verify: `npm run check` green; real Pi/Kiro run recorded; commit; push to
`origin main`.
