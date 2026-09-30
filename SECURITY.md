# Security

Rubik Arena runs on your own machine and starts AI CLIs using **your** logins, so it is built to stay local.

## Threat model and controls

| Risk | Control |
|---|---|
| Another website or LAN host drives the runner | The runner binds `127.0.0.1` only. Every `/api/*` call except `/api/health` needs the random bearer token created for that launch. The Host header must be the loopback host and port (DNS-rebinding guard). No CORS headers are sent. |
| The token leaks through the URL | The token travels only in the `#fragment`, which is never sent to servers. The dashboard moves it into `sessionStorage` and removes it from the address bar. `Referrer-Policy: no-referrer` is set. |
| A model uses agent tools on your machine | Each CLI runs in a fresh, empty temp directory with tools disabled. Pi runs with `--no-tools --no-skills --no-context-files --no-prompt-templates --no-extensions --no-session`; Kiro runs with `--trust-tools=` and `--no-interactive`. Auto-approve flags are never passed. Tests assert that `--yolo`, `--trust-all-tools` and `--dangerously-skip-permissions` are absent. |
| Command injection through model ids or prompts | Processes start with `shell: false` and an argv array. Model ids and adapter ids are checked against strict patterns (zod on the runner, again in each adapter). |
| API key exposure | Keys are read only from the runner's environment, via the `apiKeyEnv` variable name. Option keys that look like secrets (`apiKey`, `token`, `password`, …) are rejected. Plain `http` is refused for any host other than localhost. |
| Runaway processes | Every request has a timeout and every run has a wall-time limit. Cancel sends SIGTERM, then SIGKILL after 5 s. |
| Sensitive content in logs | Race files in `data/` (gitignored) contain prompts and raw answers. CLI stderr is truncated to 8 KB. Review these files before sharing them. |
| Discovery leaks credentials or consumes model credits | Discovery runs only source-controlled version/model-list probes, never a prompt. It does not read auth stores, `.env`, IDE global state, conversations or histories. Public errors and locations are sanitized. |
| IDE/Windows-host discovery crosses privacy boundaries | IDEs are detected from bounded manifests and are never launched. On WSL, the runner resolves the active Windows profile with one fixed interop probe; `RUBIK_WINDOWS_HOME` can override it. It never enumerates every Windows profile, and roots outside one canonical `/mnt/<drive>/Users/<profile>` path are rejected. Symlinks escaping an approved root are rejected. |
| Update checking downloads malicious code or enables SSRF | Update checking is metadata-only against source-controlled HTTPS GitHub coordinates, does not follow redirects, and never downloads or executes a release. Set `RUBIK_DISCOVERY_OFFLINE=1` for no outbound discovery request. |

Do not expose the runner with a reverse proxy, tunnel or `--host 0.0.0.0`. It is a local tool with no multi-user
authentication. See the detailed [discovery threat model](docs/security/discovery-threat-model.md) and
[harness contribution gate](docs/harnesses/adding-a-harness.md).

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories on this repository, not in public issues.
