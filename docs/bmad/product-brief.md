# Product Brief — Rubik Arena

## Problem

People compare LLMs on vibes. Rubik's cube solving is a compact, fully verifiable test of spatial state
tracking and long-horizon planning, but there is no easy, local, visual way to run the same cube against the
models a person already has access to (often via a logged-in CLI, not an API key) and see how fast and how
far each model gets.

## Users

- Developers and researchers who want a reproducible spatial-reasoning probe for new models.
- Enthusiasts who want to watch models "race" on a 3D cube.

## Value

- Works with **login-based CLIs** (Pi, Kiro, Codex, Claude Code, Gemini, Hermes, OpenCode) without API keys,
  plus optional BYOK OpenAI-compatible APIs and local Ollama.
- Fair: seeded scrambles, identical prompts, harness-verified moves.
- Informative even when models fail: distance-to-solved progress, per-turn timers, illegal-move counts.
- Future-proof: new models are discovered from the CLI; new tools are one adapter file.

## Success criteria (v0.1)

- One real contestant (Pi → `kiro/claude-opus-5-5`, thinking `high`) runs end-to-end from the dashboard with a
  live timer, a live 3D cube, and a persisted result.
- Baseline contestants (Kociemba solver, random mover) run without any login.
- `npm test`, typecheck, lint and build pass in CI.
