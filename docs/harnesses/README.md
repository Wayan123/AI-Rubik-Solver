# Harness and model discovery

Rubik Arena scans supported local harnesses when the runner starts. Open **Harnesses & models** in the dashboard to see the latest snapshot or press **Refresh models** after installing or updating a harness. Discovery does not send a prompt or consume model credits.

## Status and capability

- **Ready** means a safe passive probe succeeded. **Verified runnable** additionally means Rubik Arena has a reviewed benchmark adapter.
- **Catalog only** means installation can be shown, but Rubik Arena will not benchmark through that surface.
- **Login required**, **Discovery failed**, and **Unsupported version** are diagnostic states, not permission to bypass a harness safeguard.

Detected models do not modify `config/contestants.json`. Press **Add contestant** for a selectable route, review its settings, then start a race separately. A model reached through two harnesses remains two distinct routes.

| Harness | Discovery | Benchmark |
|---|---|---|
| [Pi](pi.md) | CLI, version, live model list | Verified runnable |
| [Kiro CLI](kiro.md) | CLI, version, live JSON model list | Verified runnable |
| [Hermes](hermes.md) | CLI and version | Verified runnable; model list unavailable |
| [Codex](codex.md) | CLI/version and allowlisted release metadata; known IDE manifest | Catalog only directly; Codex models through Pi remain Pi routes |
| [Claude Code](claude-code.md) | CLI and version | Catalog only |
| [Gemini CLI](gemini-cli.md) | CLI and version | Catalog only |
| [OpenCode](opencode.md) | CLI and version | Catalog only |
| [Aider](aider.md) | CLI and version | Catalog only |
| [IDE integrations](ide-integrations.md) | Verified extension manifests for Continue, Cline, Roo Code and known Codex extension | Catalog only |

## Platforms

Native Linux and macOS scan executable files in the runner's `PATH`. WSL resolves the active Windows profile with
one fixed, non-inferential `cmd.exe` environment probe and scans only that profile. If interop is unavailable or
you need an explicit override, set:

```bash
RUBIK_WINDOWS_HOME=/mnt/c/Users/YOUR_NAME npm start
```

Rubik Arena never enumerates every Windows profile and never launches an IDE. To disable outbound release metadata checks:

```bash
RUBIK_DISCOVERY_OFFLINE=1 npm start
```

Binary overrides remain server-side environment variables, for example `RUBIK_PI_BIN` and `RUBIK_KIRO_BIN`. Never put credentials in these variables or dashboard fields.

See [Adding a harness](adding-a-harness.md) and the [discovery threat model](../security/discovery-threat-model.md).
