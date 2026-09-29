# AGENTS.md — Rubik Arena

A local-first benchmark dashboard for LLMs solving a 3×3 cube. It is a TypeScript monorepo using npm workspaces and
Node ≥ 22.

## Commands

- `npm run check`: lint, typecheck, test and build. Must be green before every commit.
- `npm start`: build the dashboard and start the runner on 127.0.0.1:8787.
- `npm run test:e2e`: runs a **real model** and uses credits or tokens. Only run it when the user asks.

## Rules

- Every workflow is recorded in `docs/`:
  - BMAD brief: `docs/bmad/`
  - research: `docs/research/`
  - spec: `docs/superpowers/specs/`
  - plan: `docs/superpowers/plans/`
  - memory: `docs/operations/PROJECT-MEMORY.md`
- Project skill: `.agents/skills/rubik-arena-benchmark`.
- Pin dependencies exactly. Keep the runner bound to loopback with token auth.
- CLI adapters must use `spawnCli` with tools disabled. Never use `--yolo`, `--trust-all-tools`, `--dangerously-*`
  or anything that bypasses permissions.
- Never store API keys. Use `apiKeyEnv` (an env var name) instead.
- Bump `PROMPT_VERSION` whenever the prompt or protocol changes.
- `data/` (race logs and the runner token) is gitignored. Never commit it.
