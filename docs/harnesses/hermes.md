# Hermes Agent

Official project: https://github.com/NousResearch/hermes-agent. Evidence checked 2026-09-30.

Rubik Arena detects `hermes` from `RUBIK_HERMES_BIN` or `PATH` and reads its version. No model-list command is enabled because a stable, non-interactive, machine-readable passive contract has not yet been fixture-verified. Enter a model manually or use curated presets.

The verified adapter runs one-shot Hermes with only the `clarify` toolset. An empty toolset argument is forbidden because Hermes was observed falling back to configured tools. Never replace it with blanket auto-approval. Model calls can consume subscription or API resources only after an explicit race start.
