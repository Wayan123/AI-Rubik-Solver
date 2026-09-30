# Adding a model or CLI

Most new models need no code at all. The local runner scans supported harnesses at startup; open **Harnesses &
models** and press **Refresh models** after installing or updating one. Discovery is passive and does not send a
prompt or consume model credits. See [`docs/harnesses/README.md`](harnesses/README.md) for connection instructions
and [`docs/harnesses/adding-a-harness.md`](harnesses/adding-a-harness.md) for the security gate applied to new
harnesses.

- **A new model on a CLI you already use** (for example a future `kiro/claude-opus-6`): type its id in the Model
  field, or add a preset to `config/contestants.json`. The dashboard also lists the models each CLI reports
  (`pi --list-models`, `kiro-cli chat --list-models`).
- **A new provider with an OpenAI-compatible API**: use the `openai-compatible` adapter with `baseUrl`, and put the
  key's env var name in `apiKeyEnv`.
- **A provider that Pi supports** (Codex/ChatGPT login, Copilot, Antigravity, Anthropic, …): use the `pi` adapter
  with `provider/model`. For non-built-in providers, the Pi extension `pi-provider-<name>` is found automatically
  in `~/.pi/agent/npm/node_modules`. You can override this with `options.extensions` or `PI_PROVIDER_EXTENSIONS`.

## Writing a new CLI adapter

A CLI needs its own adapter only if it has a login you want to use directly. Implement `ModelClient` from
`@rubik-arena/bench-core`:

```ts
export class MyCliClient implements ModelClient {
  readonly kind = "llm" as const;
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const state = { text: "" };
    const r = await spawnCli({
      command: "my-cli",
      args: buildMyCliArgs(this.opts, req), // tools OFF, non-interactive, JSON output
      signal: req.signal,
      timeoutMs: req.timeoutMs,
      onLine: (line) => { /* parse JSONL, call req.onFirstToken() on the first text chunk */ },
    });
    if (r.exitCode !== 0) throw new CliError(`my-cli exited ${r.exitCode}: ${tail(r.stderr)}`);
    return { text: state.text, usage, cost, model };
  }
}
```

Then:

1. Register it in `packages/adapters/src/registry.ts` (id, auth `cli-login`, thinking levels, `detect`,
   `listModels`).
2. Record a real JSONL output as a fixture in `packages/adapters/test/fixtures/`. Strip session ids, paths and
   anything personal.
3. Add tests:
   - The argv contains the flags that disable tools and does not contain any auto-approve flag.
   - The fixture parses to the expected text and usage.
   - A non-zero exit and a model mismatch produce clear errors.

## Headless flags

These flags were checked with `--help` on 2026-09-29. Rows not marked implemented have not been probed end-to-end.

To check that tools are really off, ask the model through the adapter's argv to create a file in `$HOME` and
in the working directory, then look for the files. Pi `--no-tools` and Hermes `-t clarify` created nothing.
Kiro `--trust-tools=` attempted a Write File call and refused it.

| CLI (version) | Non-interactive, tools off | Output | Model / effort |
|---|---|---|---|
| Codex 0.157.1 | `codex exec --ephemeral --skip-git-repo-check -s read-only` | `--json`, `-o <file>` | `-m`, `-c model_reasoning_effort=…` |
| Claude Code 2.1.63 | `claude -p --tools "" --no-session-persistence --strict-mcp-config` | `--output-format stream-json` | `--model`, `--effort` |
| Gemini CLI 0.43.0 | `gemini -p <prompt> --approval-mode plan -e none` | `-o stream-json` | `-m` |
| Hermes 0.21.3 | **implemented** (`hermes` adapter): `hermes -z <prompt> --ignore-rules -t clarify`. **Never `-t ""`**: Hermes treats it as unset and loads your configured tools; observed writing to `$HOME`. | stdout, `--usage-file` | `-m`, `--provider`, `--reasoning` |
| OpenCode 1.15.3 | `opencode run --pure` | `--format json` | `-m provider/model`, `--variant` |

Never pass `--yolo`, `--dangerously-*`, `--trust-all-tools`, `bypassPermissions` or similar flags. If a CLI cannot
run with tools disabled, run it inside a container (see SECURITY.md) and document why.
