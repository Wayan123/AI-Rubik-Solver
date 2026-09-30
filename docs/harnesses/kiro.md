# Kiro CLI and IDE

Official project: https://github.com/kirodotdev/Kiro and https://kiro.dev. Evidence checked 2026-09-30.

Rubik Arena detects `kiro-cli` from `RUBIK_KIRO_BIN` or `PATH`, reads `--version`, and lists models using `kiro-cli chat --list-models --format json`. The CLI route is verified runnable. The standalone Kiro IDE is catalog-only unless a future reviewed adapter exposes a safe headless contract.

Benchmark execution uses agent engine v3, non-interactive mode, and `--trust-tools=` in an empty temporary directory. Attempted tool calls are rejected and model mismatch is an error. The CLI may consume Kiro credits only after you explicitly start a race; discovery itself does not.

Install, update, and authenticate with Kiro's official instructions. Rubik Arena does not launch the IDE or change Kiro settings.
