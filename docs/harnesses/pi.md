# Pi

Official project: https://github.com/earendil-works/pi and https://pi.dev. Evidence checked 2026-09-30.

Rubik Arena detects `pi` from `RUBIK_PI_BIN` or `PATH`, reads `pi --version`, and lists models with the audited passive command `pi --list-models`. Newly listed `provider/model` IDs become selectable Pi routes without editing presets.

Benchmark execution uses `pi -p` with `--no-tools --no-skills --no-context-files --no-prompt-templates --no-extensions --no-session` in an empty temporary directory. Required provider extensions are added explicitly. Your existing Pi login is used; Rubik Arena never reads its credential value.

If a model does not appear, run `pi --list-models` yourself and refresh the dashboard. Discovery does not call `pi update`; update or log in using Pi's official instructions. Never add auto-approval or permission-bypass flags to the adapter.
