# Rubik Arena — Project Memory

Updated 2026-09-29. Labels: **observed** = checked by command or test, **inferred** = reasoned from evidence.

## Status

M1 is complete.

- The engine, bench core, adapters (`pi`, `kiro-cli`, `openai-compatible`, `kociemba`, `random`), the loopback
  runner and the 3D dashboard are built.
- 110 offline tests pass, along with lint, typecheck and build (observed).

Live runs, all observed on 2026-09-29:

- Pi → `kiro/claude-opus-5-5`, thinking high, depth 3: solved in 22.7 s, 1 turn.
- The same, depth 5 (seed 7): solved in 873 s, 6 turns, 47 moves.
- `kiro-cli` Opus 5.5, depth 3: solved in 56.3 s, 1.15 credits.
- A browser race (Opus 5.5 vs Kociemba) displayed correctly. Screenshot: `docs/images/arena-first-race.png`.

## Key facts (observed)

- `kiro-cli` engine v2 ignores `--model` ("failed to set model … Method not found") and uses `auto`. Engine v3
  applies the model. `--effort high` came back as `effortLevel: medium`. The adapter errors on a model mismatch and
  records the effective effort.
- Pi must run with `--no-extensions` so user extensions (WhatsApp, memory and similar) don't load inside benchmark
  runs. The Kiro provider is re-added explicitly with `-e ~/.pi/agent/npm/node_modules/pi-provider-kiro`.
- Pi exits 0 even for an unknown model id; it prints a warning and uses a "custom model id". Usage comes from the
  `turn_end` event.
- `cubejs` two-phase gives about 8 moves for a single `R` (not optimal). Because of this, the exact distance comes
  from our own 4-ply table plus a forward search. `cubejs/lib/solve.js` reads `this.Cube`, which needs the Vite
  transform in `apps/web/vite.config.ts` to work in ESM.
- npm scripts call `vite` and `tsx` directly. An old npm on the script PATH looped forever on
  `npm run --workspace`.

## Next (M2 candidates)

- Adapters for Codex, Claude Code, Gemini CLI, Hermes and OpenCode. Flags are recorded in
  `docs/adding-a-model.md` but not yet probed end-to-end.
- Batch mode: N seeds × depths per contestant, plus aggregate charts.
- Static demo deployment to GitHub Pages.
