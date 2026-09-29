---
name: rubik-arena-benchmark
description: Use when running, extending or reporting Rubik Arena LLM cube-solving benchmarks in this repository — adding a model/CLI adapter, running a live race, changing prompts, or publishing results.
---

# Rubik Arena benchmark workflow

Read `AGENTS.md` and `docs/operations/PROJECT-MEMORY.md` first.

## Run

- Offline checks: `npm run check` (lint, `tsc -b`, 110+ Vitest tests, build). These never call real models.
- Dashboard: `npm start`, then open the printed `http://127.0.0.1:8787/#token=…` link.
- Live CLI run (costs credits; needs user approval): `npm run test:e2e`. Configure it with the env vars
  `RUBIK_E2E_ADAPTER`, `RUBIK_E2E_MODEL`, `RUBIK_E2E_THINKING`, `RUBIK_E2E_DEPTH`, `RUBIK_E2E_SEED`,
  `RUBIK_E2E_MODE` and `RUBIK_E2E_TURNS`.

## Add a model source

Follow `docs/adding-a-model.md`:

1. Implement `ModelClient`.
2. Use `spawnCli` (argv array, empty temp dir, tools disabled).
3. Register the adapter.
4. Add a sanitized real fixture.
5. Add tests for the tool-disabling argv, fixture parsing and errors.

Never add auto-approve flags.

## Report results

Every published number must include:

- prompt version
- mode
- seeds and depths
- n runs
- CLI version
- reported model
- reported effort

A single run is evidence that the pipeline works, not a ranking. When describing distance, keep exact distance
and the `≤` Kociemba upper bound separate.
