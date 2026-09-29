# Rubik Arena — Design Spec (PRD + Architecture of record)

Date: 2026-09-29 · Status: approved 2026-09-29 (hybrid access; M1 = Pi → Kiro Opus 5.5 high) · Brief: `docs/bmad/product-brief.md` ·
Research: `docs/research/2026-09-29-landscape.md`

## 1. Goal

A local-first, open-source dashboard where a user configures contestants (one model at a time or several in
parallel), gives them the same seeded 3×3 scramble, and watches each one solve it on a live 3D cube with a
running timer. Every move is verified by the harness. Results are stored and comparable.

Milestone 1 (this spec) must work end-to-end with **one real model: Pi → `kiro/claude-opus-5-5`, thinking
`high`**, plus login-free baselines. Other CLIs follow the same adapter contract in later milestones.

## 2. Requirements

### Functional

- **FR1 Contestants.** A contestant = adapter + model + options (thinking/effort, mode, limits) + label.
  Adapters in M1: `pi` (CLI, login-based), `kiro-cli` (CLI, login-based), `openai-compatible` (BYOK API,
  also covers Ollama/OpenRouter/DeepSeek/vLLM), `kociemba` (baseline), `random` (baseline).
- **FR2 Model discovery.** For CLI adapters the runner lists models from the CLI itself
  (`pi --list-models`, `kiro-cli chat --list-models --format json`); the user can also type any model ID.
- **FR3 Scramble.** Seeded random-move scramble (`seed`, `depth` 1–30, default 20; no consecutive same-face
  turns) or a pasted scramble sequence. The same scramble is given to every contestant in a race.
- **FR4 Modes.**
  - `one-shot`: one request; the model returns the full move list; the harness applies it.
  - `interactive`: up to `maxTurns` (default 30) requests; each turn the model receives the current state,
    move history and last feedback and returns 1–`maxMovesPerTurn` (default 10) moves.
- **FR5 Output protocol.** Model must answer with JSON `{"moves": ["R", "U'", "F2", ...]}`. Accepted tokens:
  the 18 face turns `U D L R F B` with suffix none, `'`, `2` (also `’` and `2'` normalized). Rotations, slices
  and wide moves are rejected in M1. The last JSON object containing `moves` in the text is used (code fences
  allowed). Any invalid token rejects the whole response (`invalid_output`); in interactive mode the turn is
  consumed and the error is fed back; after 3 consecutive invalid outputs the run stops.
- **FR6 Timers and metrics** per run: `wallMs` (start→finish, measured by the runner with a monotonic clock),
  per-turn `latencyMs` and `ttftMs` when the adapter streams, `turns`, `movesApplied`, `invalidOutputs`,
  `solved`, `initialDistance`, `bestDistance`, `finalDistance`, `progress = (initial − best) / initial`,
  `tokensIn`, `tokensOut`, `cost` (`{value, unit}` e.g. USD or Kiro credits) when reported, `error`.
  The dashboard shows a live ticking timer per lane and the final numbers.
- **FR7 Distance.** Distance-to-solved = length of the Kociemba two-phase solution (cubejs) in HTM. Labelled
  "Kociemba distance" (an upper bound, not guaranteed optimal). Computed after every applied move for charts.
- **FR8 Limits.** Per-request timeout (default 600 s), per-run wall limit (default 1 800 s), cancel button,
  one-shot move cap 300.
- **FR9 Race.** A race runs N contestants on the same scramble, `concurrency` 1 (one by one, default) or up
  to 4 in parallel.
- **FR10 Live view.** Per contestant lane: 3D cube animating applied moves, timer, status, move count,
  distance sparkline, last raw response (collapsible). Leaderboard sorted by solved, then progress, then time.
- **FR11 History & replay.** Every race is saved as JSON under `data/races/`; the dashboard lists past races,
  re-opens them, replays moves, and exports JSON.
- **FR12 Demo mode.** If the runner is unreachable (e.g. static GitHub Pages build), the web app runs the
  `kociemba` and `random` baselines in the browser; LLM adapters are shown as "requires local runner".
- **FR13 Presets.** `config/contestants.json` holds user-editable presets; the default ships the Pi/Kiro
  Opus 5.5 high preset and the baselines. BYOK entries reference an env var name (`apiKeyEnv`), never a key.

### Non-functional

- **NFR1 Security.** Runner binds `127.0.0.1` only; every `/api/*` route except `/api/health` requires a
  per-launch random bearer token; `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding
  guard); no CORS. CLI children are spawned with an argv array (no shell), in a fresh empty temp directory,
  with tools disabled (see §4.3), killed on timeout/cancel (SIGTERM, then SIGKILL after 5 s). API keys are read
  from the runner's environment only and never sent to the browser, logged or stored.
- **NFR2 Fairness.** Identical system prompt, state encoding and parser for all LLM contestants; prompt
  version is stored in every result (`promptVersion`).
- **NFR3 Extensibility.** Adding a CLI or provider = one adapter module implementing `ModelClient` plus a
  registry entry; no change in engine, bench core or web.
- **NFR4 Quality.** TypeScript strict; Vitest unit tests for engine, bench core, adapters (with fake CLIs)
  and runner routes; Biome lint; CI runs lint, typecheck, test, build. The real-model test is opt-in
  (`RUBIK_E2E_PI=1`).
- **NFR5 Portability.** Node ≥ 22, npm workspaces, Linux/macOS/WSL. No native modules.

## 3. Architecture

```
apps/web  (React 19 + Vite 8 + react-three-fiber)  ──HTTP/SSE, bearer token──▶  apps/runner (Fastify 5, 127.0.0.1)
    │  demo mode: baselines in browser                                             │
    └────────────── packages/cube-engine ◀── packages/bench-core ◀── packages/adapters ─┘
                                                                        │ spawn (no shell, no tools)
                                                              pi · kiro-cli · (codex, claude, gemini, hermes, opencode later)
                                                                        │ fetch
                                                              OpenAI-compatible APIs / Ollama
```

- `packages/cube-engine` — facelet model (54-char `URFDLB` string, cubejs-compatible), `parseMoves`,
  `applyMoves`, `isSolved`, `scramble(seed, depth)` (mulberry32 PRNG), `renderNet(state)` (text net for
  prompts), `kociembaDistance(state)` / `solve(state)` wrapping cubejs. Pure, used by runner and web.
- `packages/bench-core` — types (`ContestantConfig`, `RaceConfig`, `RunEvent`, `RunResult`), prompt builder
  (`PROMPT_VERSION`), response parser, `runContestant(client, config, scramble, signal, emit)` for both modes,
  metrics, `runRace` with concurrency.
- `packages/adapters` — `ModelClient` interface:
  `complete({system, user, signal, onFirstToken}) → {text, usage?: {tokensIn, tokensOut}, cost?, raw?}` plus
  `listModels()`. Implementations: `pi`, `kiro-cli`, `openai-compatible`, and non-LLM `kociemba`, `random`
  (these implement a `Solver` interface consumed directly by bench core). Shared `spawnCli` helper with
  timeout, abort, stdout line streaming, stderr capture (truncated to 8 KB).
- `apps/runner` — REST + SSE: `GET /api/health`, `GET /api/adapters`, `GET /api/adapters/:id/models`,
  `GET /api/presets`, `POST /api/races`, `GET /api/races`, `GET /api/races/:id`,
  `GET /api/races/:id/events` (SSE, replays past events then streams), `POST /api/races/:id/cancel`.
  Serves the built web app at `/`. Prints `http://127.0.0.1:8787/#token=<token>` on start; the web app moves
  the token from the URL fragment into `sessionStorage` and strips it from the URL.
- `apps/web` — pages: Arena (configure + live lanes + leaderboard), History (list, replay, export).
  Cube component draws 26 cubies from the facelet string and animates quarter turns.

## 4. Key decisions

1. **TypeScript monorepo, no build step for internal packages** (source `exports` consumed by Vite and tsx).
2. **Own facelet engine + cubejs only for solving**; the engine is cross-checked against cubejs in tests.
3. **Pi adapter isolation:** `pi -p --mode json --no-session --no-tools --no-skills --no-context-files
   --no-prompt-templates --no-extensions -e <provider extension> --model <provider/model> --thinking <level>
   --system-prompt <system> <user>`. `--no-extensions` stops user extensions (messaging, memory, etc.) from
   running inside benchmarks; the provider extension for non-built-in providers is resolved from
   `~/.pi/agent/npm/node_modules/pi-provider-<provider>` or `PI_PROVIDER_EXTENSIONS` / preset `extensions`.
   Usage comes from the final `turn_end` event.
4. **Kiro-cli adapter uses `--agent-engine v3`** (v2 silently falls back to `auto`), `--trust-tools=`, and
   records the effort level Kiro reports back, because `--effort` was observed not to apply.
5. **JSON files for storage** (`data/races/<id>.json`), gitignored; easy export and diff.
6. **SSE over fetch** (not `EventSource`) so the bearer token travels in a header.

## 5. Error handling

Adapter errors (spawn failure, non-zero exit, timeout, auth failure text, JSON parse error) end the run with
`status: "error"` and a truncated message; other contestants continue. Cancel aborts all in-flight children.
A crashed runner leaves partial race files marked `status: "interrupted"` on next start.

## 6. Testing

- Engine: move tables (each move ×4 = identity, known sequences vs cubejs, sexy-move ×6 = identity),
  scramble determinism, net rendering snapshot.
- Bench core: parser table tests (fences, prose, primes, invalid tokens), one-shot and interactive runs with a
  scripted fake client (solve, invalid output ×3 stop, timeout, cancel), metrics maths.
- Adapters: `spawnCli` against a fake CLI script (streaming, timeout kill, non-zero exit); pi/kiro JSONL
  parsers on recorded fixtures from the observed probes; openai-compatible against a local fake server.
- Runner: Fastify `inject` for auth, Host guard, race lifecycle with baseline contestants.
- Web: pure state reducers tested with Vitest; manual/automated browser check of the live race.
- Opt-in live test: `RUBIK_E2E_PI=1 npm run test:e2e` runs Pi/Kiro Opus 5.5 high on a depth-3 scramble.

## 7. Out of scope for M1

Codex/Claude Code/Gemini/Hermes/OpenCode adapters (documented contract; flags recorded in research), vision
(image) state input, multi-user hosting, 2×2/4×4 cubes, leaderboards shared online.
