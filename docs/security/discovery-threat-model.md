# Discovery threat model

Date: 2026-09-30. Scope: local harness/model/update discovery, not the model benchmark prompt itself.

## Assets and boundaries

Assets include harness credentials, model credits, runner bearer token, local paths/usernames, harness configuration, and benchmark integrity. Trust boundaries are browser to loopback runner, runner to untrusted local files, runner to potentially shadowed executables, WSL to the Windows host, and runner to official release endpoints.

## Threats and controls

| Threat | Control | Residual risk |
|---|---|---|
| Malicious binary shadows a supported name in `PATH` | Resolve real executable, display sanitized location, static low-impact probes, immutable capability policy | A version/list probe still executes local code already trusted by the user's PATH |
| Browser command/URL injection | Discovery endpoints accept no command, path, repository, URL, extension ID, or probe arguments | A compromised runner process already has local-user privileges |
| Probe mutates state | Allowlisted commands only, no login/update/IDE commands, empty temporary cwd, timeout and output cap | Upstream may change command behavior; unsupported versions must be reviewed |
| Output flood or hang | Byte limit, timeout, abort, SIGTERM then SIGKILL | OS-level process bugs remain possible |
| Secret/path leakage | Central sanitization, home-root replacement, credential/query/control-character redaction, no raw stderr in UI | Novel secret formats may evade patterns; raw local runner logs must stay minimal |
| Malicious manifest/symlink | Approved roots, `lstat`, `realpath`, containment, regular-file and size checks, declared identity check | A malicious regular manifest inside an approved root can lie about non-sensitive metadata only |
| Cross-user Windows exposure | Only explicit/active Windows home, no `/mnt/c/Users/*` enumeration, sanitized API output | A wrongly configured `RUBIK_WINDOWS_HOME` can expose that profile's extension names |
| IDE side effects | File-only detection; IDE binaries are never launched | Marketplace state can be stale relative to files |
| Credential scraping | No keychain, auth file, `.env`, IDE global storage/SQLite, settings sync, history or conversation reads | Readiness may be less precise and show catalog-only/login uncertainty |
| SSRF/redirect abuse | Source-controlled HTTPS GitHub endpoint, fixed owner/repository, manual redirects, bounded schema | GitHub sees ordinary network metadata unless offline mode is used |
| Supply-chain compromise | Metadata only; no download, install, or execution; human follows official release link | Official account/repository compromise can publish misleading metadata |
| Paid inference during discovery | No prompt command or inference endpoint; exact argv tests | Upstream may make a model-list command networked, but it must not perform inference |
| Catalog-only privilege escalation | `selectable` computed server-side from immutable policy; race API validates adapter | User can still manually enter an ID for an already verified adapter by design |
| Refresh abuse | Bearer auth, Host guard, single-flight, 10-second cooldown, bounded concurrency | Authenticated local user can intentionally consume local CPU/process starts |
| Stored/reflected XSS | React text rendering, bounded/control-clean strings, CSP, no raw HTML | Official links still leave the local application when clicked explicitly |

## Privacy mode

Set `RUBIK_DISCOVERY_OFFLINE=1` to disable outbound release metadata checks. Local binary and manifest discovery still runs. Update checking sends no source, model list, path, username, configuration, or credentials, but the remote endpoint observes normal IP and HTTP metadata.

## Incident response

Stop the runner, preserve the sanitized reproduction and exact harness version, and report privately through GitHub Security Advisories. Do not post credentials, raw discovery output, race logs, or private paths in a public issue.
