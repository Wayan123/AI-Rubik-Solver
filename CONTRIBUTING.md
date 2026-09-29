# Contributing

Thanks for helping. Rubik Arena is a small TypeScript monorepo; keep changes focused.

1. `npm install`, then `npm run check` (Biome, `tsc -b`, Vitest, build) must pass.
2. New behaviour needs tests. Adapters must be tested against a fake CLI or a fake HTTP server; the default test
   run must not call real models.
3. If you change prompts or the output protocol, bump `PROMPT_VERSION` in `packages/bench-core/src/prompt.ts`.
   Results from different prompt versions are not comparable.
4. Pin dependencies to exact versions (no `^` or `~`).
5. Security-relevant code (spawn flags, auth, schema) needs a test that locks the safe behaviour.

To add a model source, follow [docs/adding-a-model.md](docs/adding-a-model.md).

Benchmark results you publish should state: prompt version, mode, scramble seeds and depths, number of runs, CLI
version, model id as reported, and the thinking or effort level the CLI reported back.
