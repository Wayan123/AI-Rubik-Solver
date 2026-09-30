# Automatic Harness and Model Discovery — Design Spec

Date: 2026-09-30
Status: approved in chat; pending written-spec review
Initiative: automatic harness and model discovery
Extends: `docs/superpowers/specs/2026-09-29-rubik-arena-design.md`

## 1. Goal

Rubik Arena will automatically discover supported AI harnesses, IDE integrations, installed versions, available model catalogs, and trustworthy update metadata. Discovery runs when the local runner starts and can be repeated with a **Refresh harnesses & models** button.

The feature makes newly released models visible without editing `config/contestants.json`. A discovered model is added to a runtime catalog, not to the curated preset file. The user must explicitly add the model as a contestant and explicitly start a race.

Discovery is passive: it must not send a model prompt, start a benchmark, consume credits, install software, update software, authenticate an account, modify another harness, or execute an IDE.

## 2. Product decisions

The following decisions were approved:

1. **Runtime catalog, curated presets.** Discovery updates an in-memory catalog. It never writes `config/contestants.json`.
2. **Official supported harness registry.** Rubik Arena detects only harnesses defined in a reviewed, source-controlled registry. Arbitrary repositories and executable names supplied by the browser are not loaded.
3. **CLI and IDE surfaces.** CLI harnesses, standalone IDEs, and known IDE extensions may be detected. Detection alone never makes a surface benchmark-capable.
4. **Cross-environment discovery.** Support native Linux/macOS and WSL plus its active Windows host. Native Windows runner support remains outside the existing platform guarantee.
5. **Startup plus manual refresh.** Scan once when the runner starts. Dashboard startup reads that snapshot; if no snapshot exists, its first authenticated request starts one. Manual refresh is available. There is no polling.
6. **Passive readiness checks.** Discovery may check installation, version, safe official model-list interfaces, and official release metadata. It does not send test prompts.
7. **Security before breadth.** Unverified integrations are `catalog-only`. They become runnable only after their execution adapter and isolation behavior pass the repository's safety gate.
8. **No auto-update.** Rubik Arena may report an available update and link to official instructions. It never downloads or installs the update.

## 3. Success criteria

- A model newly exposed by Pi or Kiro's audited model-list command appears after startup or manual refresh without a source change.
- The catalog shows the execution route separately, so identical model names reached through different harnesses remain distinct.
- Installed supported CLIs and known IDE/extension surfaces are shown with environment, version when safely available, capability, and a sanitized status.
- A catalog entry can populate a contestant only when a verified adapter can execute that exact route.
- One failed or slow detector does not hide successful results from other detectors.
- Discovery uses no model inference and makes no paid model call.
- Offline mode performs no outbound network request.
- Existing `/api/adapters`, `/api/adapters/:id/models`, presets, and race behavior remain compatible.
- `npm run check` passes without running `npm run test:e2e`.

## 4. Non-goals

This initiative does not:

- install, update, remove, or log into a harness;
- load connector code from GitHub, npm, an IDE marketplace, or a user-provided URL at runtime;
- scrape credential stores, keychains, browser profiles, conversation history, telemetry, or IDE global-state databases;
- scan every Windows user profile from WSL;
- execute an IDE to ask for its version or model list;
- send a prompt to validate account access;
- make an integration runnable because a matching binary or extension exists;
- guarantee model availability until a user starts a race;
- replace the manual model-ID field;
- add native Windows runner support in this milestone.

## 5. Domain model

### 5.1 Capability and trust are separate

**Detect != trust != execute.** A detector reports local evidence. A source-controlled capability policy determines what Rubik Arena permits.

Support levels:

- `verified-runnable`: a reviewed adapter exists and its safe headless invocation is covered by fixtures and negative security tests;
- `catalog-only`: installation can be displayed, but Rubik Arena cannot benchmark through it;
- `community-candidate`: documented for contributors but absent from the runtime registry;
- `blocked`: known execution requires unsafe permissions, auto-approval, or isolation that Rubik Arena cannot verify.

Discovery status:

- `ready`: installation is found and the permitted catalog probe succeeded; for a runnable route, a verified adapter exists;
- `login-required`: installation is found but an audited probe reports that authentication is required;
- `catalog-only`: installation is found but execution or model discovery is intentionally unsupported;
- `unavailable`: no allowed installation evidence is found;
- `discovery-failed`: installation evidence exists, but a permitted probe failed;
- `unsupported-version`: installation exists but is outside the adapter's verified version range.

### 5.2 API types

The shared API contract will use these shapes, with exact field names preserved during implementation:

```ts
type DiscoveryState = "idle" | "scanning" | "ready" | "partial" | "failed";
type HarnessSurface = "cli" | "ide" | "extension";
type EnvironmentKind = "linux" | "macos" | "wsl" | "windows-host";
type SupportLevel = "verified-runnable" | "catalog-only" | "blocked";
type HarnessStatus =
  | "ready"
  | "login-required"
  | "catalog-only"
  | "unavailable"
  | "discovery-failed"
  | "unsupported-version";
type ModelSource = "live-cli" | "local-catalog" | "official-catalog";

interface RuntimeEnvironment {
  id: string;
  kind: EnvironmentKind;
  label: string;
  available: boolean;
}

interface HarnessUpdate {
  current: string;
  latest: string;
  releaseUrl: string;
  publishedAt?: string;
}

interface DiscoveredHarness {
  instanceId: string;
  harnessId: string;
  displayName: string;
  surface: HarnessSurface;
  environmentId: string;
  status: HarnessStatus;
  supportLevel: SupportLevel;
  version?: string;
  sanitizedLocation?: string;
  adapterId?: string;
  modelDiscovery: "live" | "local" | "none";
  documentationUrl: string;
  repositoryUrl?: string;
  update?: HarnessUpdate;
  message?: string;
}

interface DiscoveredModel {
  routeId: string;
  harnessInstanceId: string;
  adapterId?: string;
  modelId: string;
  provider?: string;
  displayName?: string;
  source: ModelSource;
  selectable: boolean;
  thinkingLevels: string[];
}

interface DiscoveryWarning {
  code: string;
  harnessInstanceId?: string;
  message: string;
}

interface DiscoverySnapshot {
  generation: number;
  state: DiscoveryState;
  startedAt?: string;
  completedAt?: string;
  environments: RuntimeEnvironment[];
  harnesses: DiscoveredHarness[];
  models: DiscoveredModel[];
  warnings: DiscoveryWarning[];
  offline: boolean;
}
```

`routeId` and `instanceId` are deterministic identifiers derived from registry IDs and environment IDs, not local paths. Raw filesystem paths are never identifiers.

## 6. Architecture

```text
apps/web
  HarnessCatalog panel
       | GET snapshot / POST refresh (bearer token)
       v
apps/runner
  DiscoveryService: single-flight, generation, cooldown, snapshot
       |
       +--> packages/adapters/discovery
       |      registry + environment resolver + detector plugins
       |      parsers + sanitization + capability policy
       |
       +--> official release metadata checker (optional, allowlisted HTTPS)

Existing race path remains unchanged:
apps/web -> apps/runner -> packages/adapters -> verified CLI/API adapter
```

### 6.1 Module boundaries

- `packages/adapters/src/discovery/types.ts`: shared discovery domain types.
- `packages/adapters/src/discovery/registry.ts`: reviewed harness definitions and immutable capability policy.
- `packages/adapters/src/discovery/environment.ts`: native OS, WSL, active Windows host, PATH, and known IDE-root resolution.
- `packages/adapters/src/discovery/files.ts`: bounded safe file and manifest inspection.
- `packages/adapters/src/discovery/sanitize.ts`: redaction and stable diagnostic messages.
- `packages/adapters/src/discovery/releases.ts`: optional official release metadata lookup with an injected fetch seam.
- `packages/adapters/src/discovery/detectors/*.ts`: small detector plugins with no UI or race knowledge.
- `apps/runner/src/discovery.ts`: `DiscoveryService`, snapshot lifecycle, single-flight behavior, and refresh cooldown.
- `apps/runner/src/server.ts`: authenticated discovery routes.
- `apps/web/src/discovery.ts`: pure grouping/filtering/staleness helpers.
- `apps/web/src/components/HarnessCatalog.tsx`: catalog UI and add-contestant actions.

Discovery is kept beside adapters because detector evidence and adapter capability must agree. The runner owns scheduling and API lifecycle. The web app only renders server decisions and cannot promote capabilities.

### 6.2 Harness definition contract

```ts
interface HarnessDefinition {
  id: string;
  displayName: string;
  surfaces: readonly HarnessSurfaceDefinition[];
  documentationUrl: `https://${string}`;
  repositoryUrl?: `https://github.com/${string}/${string}`;
  releaseSource?: {
    host: "api.github.com";
    owner: string;
    repository: string;
    includePrereleases: false;
  };
  supportLevel: SupportLevel;
  adapterId?: string;
  verifiedVersion?: { minimum?: string; maximumExclusive?: string };
  detector: HarnessDetector;
}

interface HarnessDetector {
  detect(context: DiscoveryContext): Promise<HarnessDetection[]>;
}
```

A definition contains code-selected commands and locations. No executable, arguments, repository, endpoint, or path arrives from the browser.

### 6.3 Discovery lifecycle

1. Runner creates `DiscoveryService` with the static registry.
2. Runner starts generation 1 in the background after binding to loopback.
3. Environment resolver identifies native OS and WSL status.
4. Detectors run with bounded concurrency. Each has a per-step timeout and shared abort signal.
5. Safe model-list probes run only for definitions whose commands are audited.
6. Results are normalized, deduplicated by route, and sanitized.
7. If network checks are allowed, release metadata is fetched only for definitions with an approved release source.
8. The completed immutable snapshot replaces the previous snapshot atomically.
9. Manual refresh creates the next generation. Concurrent callers receive the same in-flight operation.
10. A successful previous snapshot remains readable while a refresh is running; its state is returned as `scanning` with the prior catalog.

A detector failure produces a warning and does not reject the whole scan. `partial` means at least one detector failed while another produced usable evidence. `failed` means no usable environment or harness result could be produced.

## 7. Environment and installation discovery

### 7.1 Native Linux and macOS

- Resolve binaries by iterating the process `PATH` using Node filesystem APIs; do not invoke `which`, `where`, or a shell.
- Apply `realpath`, verify a regular executable file, and retain only a sanitized display location.
- Environment overrides such as `RUBIK_PI_BIN` remain authoritative, but are runner environment variables—not API fields.
- Inspect only registry-declared application and extension roots.

### 7.2 WSL and active Windows host

- WSL is detected from stable kernel/OS evidence.
- The Windows home may be provided by `RUBIK_WINDOWS_HOME`.
- If not configured, a fixed, internal Windows interop probe may resolve the active Windows profile. It accepts no browser or user-supplied command fragment.
- If the active profile cannot be determined uniquely, Windows-host discovery is skipped with a sanitized warning.
- Never enumerate and scan every `/mnt/c/Users/*` profile.
- Scan only known IDE installation manifests and extension roots beneath the active profile.
- Do not execute `code`, `cursor`, `windsurf`, Kiro IDE, or other IDE binaries. Local observation showed that even `code --version` from WSL may install/update VS Code Server, so IDE detection is file-only.

### 7.3 IDE extension evidence

- Match exact, registry-allowlisted extension IDs, case-insensitively where the host filesystem requires it.
- Read only a bounded `package.json`/product manifest needed for ID and version.
- Reject oversized files, non-regular files, symlinks escaping the approved root, malformed JSON, and manifests whose declared identity does not match the expected extension.
- Do not read VS Code `globalStorage`, SQLite databases, extension secrets, settings sync data, or logs.
- Workspace marker files such as `CLAUDE.md`, `GEMINI.md`, `.clinerules`, or `AGENTS.md` are not installation evidence and are not scanned for this feature.

## 8. Model discovery policy

A model probe must satisfy all of these conditions:

1. Officially documented or directly verified against the installed harness.
2. Non-interactive and machine-readable, or parsed by a fixture-covered deterministic parser.
3. Does not send a prompt or start an inference request.
4. Uses static argv with `shell: false` in an empty temporary directory when a child process is required.
5. Has a strict timeout and bounded stdout/stderr.
6. Cannot install, update, log in, mutate configuration, or start an IDE.
7. Has tests for malformed output, non-zero exit, timeout, and secret-bearing error text.

Initial policy:

- **Pi CLI:** live models through audited `pi --list-models`; route remains `provider/model`.
- **Kiro CLI:** live models through audited `kiro-cli chat --list-models --format json`.
- **Hermes:** installation/version discovery; model discovery remains `none` until an official non-interactive model-list command is verified with fixtures.
- **Codex CLI:** installation/version discovery; no invented `codex list-models` command. Direct Codex models remain catalog-only until an official stable programmatic interface is implemented and audited. Models visible through Pi's `openai-codex/*` route remain Pi routes.
- **IDE integrations:** v1 detects product/extension and version only. It does not parse credential-bearing IDE state to infer models.
- **Other candidate CLIs:** model-list support is disabled until each command passes the same gate, even if upstream documentation appears to advertise a list operation.

Manual model IDs remain supported by existing verified adapters. A model absent from the catalog is not automatically considered unsafe; it is simply unverified by the latest snapshot.

## 9. Initial harness registry

The runtime registry initially documents these official projects/surfaces. Repository ownership, extension IDs, commands, and release sources must be confirmed from primary upstream material during implementation; an uncertain value is omitted rather than guessed.

| Harness | Official upstream | Initial detection | Model discovery | Initial execution |
|---|---|---|---|---|
| Pi coding agent | `https://github.com/earendil-works/pi` and installed Pi package metadata | CLI, version, configured provider packages | audited live CLI list | verified runnable |
| Kiro | `https://github.com/kirodotdev/Kiro`, `https://kiro.dev` | CLI plus standalone IDE manifests | audited live CLI JSON | CLI verified runnable; IDE catalog-only |
| Hermes Agent | `https://github.com/NousResearch/hermes-agent` | CLI and version | none initially | verified runnable with `clarify`-only toolset |
| OpenAI Codex | `https://github.com/openai/codex` | CLI and official IDE extension manifest | none initially | catalog-only until adapter safety work |
| Claude Code | `https://github.com/anthropics/claude-code` | CLI and official IDE integration manifest when verified | none initially | catalog-only |
| Gemini CLI | `https://github.com/google-gemini/gemini-cli` | CLI and version | none initially | catalog-only |
| OpenCode | `https://github.com/anomalyco/opencode` | CLI and verified extension manifests | none initially | catalog-only |
| Aider | `https://github.com/Aider-AI/aider` | CLI and version | disabled pending probe audit | catalog-only |
| Continue | `https://github.com/continuedev/continue` | verified IDE extension manifests | none initially | catalog-only |
| Cline | `https://github.com/cline/cline` | verified IDE/CLI manifests | none initially | catalog-only |
| Roo Code | `https://github.com/RooCodeInc/Roo-Code` | verified IDE/CLI manifests | none initially | catalog-only |

This table is not permission to add unverified literals. Implementation tests must pin every enabled extension ID and command to primary-source evidence recorded in `docs/harnesses/`.

## 10. Update metadata

### 10.1 Behavior

- Update checks are enabled only when a definition has a reviewed release source that corresponds to the installed artifact.
- The runner performs unauthenticated HTTPS `GET` requests to an allowlist of `api.github.com` endpoints or another explicitly reviewed first-party endpoint.
- It sends no project source, installed model list, local path, username, harness configuration, token, or credential. Normal network metadata such as the user's IP remains visible to the endpoint.
- Responses have byte and time limits and strict schema parsing.
- Semantic versions are compared only when both versions can be normalized safely. Unknown/vendor version schemes produce no update claim.
- Prereleases are ignored.
- A rate-limit, offline state, or network failure becomes a warning and never degrades local installation/model discovery.
- Results are cached for the runner lifetime. There is no polling.
- `RUBIK_DISCOVERY_OFFLINE=1` disables all outbound discovery network calls.

### 10.2 No updater

The dashboard displays current version, latest verified version, publication date when known, and an official HTTPS release/documentation link. It never offers an install action. It does not run `curl | sh`, package managers, native updaters, IDE commands, or downloaded binaries.

## 11. Runner API

All discovery routes except the existing health route require the runner bearer token and existing Host-header guard.

- `GET /api/discovery`
  - Returns the latest snapshot.
  - Starts an initial scan only if the runner has no current or in-flight snapshot.
  - Returns `200`; scan state is represented in the body.
- `POST /api/discovery/refresh`
  - Starts or joins a single in-flight refresh.
  - Returns `202` with the current snapshot/generation.
  - Returns `429` with a sanitized retry interval when the cooldown applies.
- `GET /api/discovery/status`
  - Returns generation, state, timestamps, and warning count without repeating the full catalog.

Manual refresh has a 10-second server-side cooldown measured from scan start. This limits accidental button spam without preventing a user from rescanning after installing a harness. The exact value is server policy and is covered by tests.

The old endpoints remain:

- `GET /api/adapters` continues to report registered race adapters.
- `GET /api/adapters/:id/models` continues to work for compatibility and delegates to the same audited parser/probe used by discovery where applicable.
- `GET /api/presets` remains file-backed and unchanged.

No discovery endpoint accepts a command, executable path, filesystem path, repository owner/name, URL, extension ID, or model probe arguments from the request.

## 12. Dashboard UX

A new **Harnesses & models** panel appears near contestant setup.

It provides:

- scan state and last completed time;
- **Refresh harnesses & models** button;
- search by model, provider, or harness display name;
- filters for Ready, Login required, Catalog only, Unavailable, Discovery failed, and Updates;
- environment grouping for native environment and Windows host;
- harness cards with surface, sanitized version/location, capability badge, update badge, and official documentation link;
- model groups by harness instance and provider;
- **Add contestant** only for `selectable: true` routes.

Accessibility:

- Scan state uses a polite `aria-live` status.
- Refresh has a visible busy state and remains protected against duplicate actions.
- Badges are accompanied by text, not color alone.
- Errors are actionable but do not expose raw stderr or local identity.
- Keyboard users can search, filter, expand a harness, and add a contestant.

Adding a discovered model:

1. Copy the registry-selected `adapterId`, exact `modelId`, and supported thinking levels into a new contestant draft.
2. Generate a unique local contestant ID.
3. Use a neutral label derived from model and harness; the user may edit it.
4. Do not start a race.

If a selected model disappears on refresh, retain the draft and show **Not present in latest catalog**. The user may keep or remove it. A running race is never changed by discovery.

Demo mode shows a short explanation that local harness discovery requires `npm start`; it does not fabricate installed harnesses.

## 13. Security threat model

### 13.1 Assets

- CLI and IDE credentials owned by the user;
- local filesystem paths and usernames;
- runner bearer token;
- model subscriptions and credits;
- integrity of contestant configuration and benchmark results;
- integrity of the local machine and installed harness configurations.

### 13.2 Trust boundaries

- Browser to loopback runner: untrusted request input, protected by bearer token and Host guard.
- Runner to local filesystem: manifests and configuration are untrusted data.
- Runner to local executable: a matching filename does not prove publisher identity.
- WSL to Windows host filesystem/interoperability: separate environment with privacy and path-boundary concerns.
- Runner to GitHub/first-party release endpoint: untrusted network response.
- Discovery catalog to race adapter: catalog data cannot grant execution capability.

### 13.3 Threats and controls

| Threat | Required control |
|---|---|
| PATH shadowing with a malicious `pi`/`codex` binary | Resolve and display a sanitized real path; run only static low-impact probes; never promote capability from path evidence; keep race adapters source-controlled |
| Command injection | `shell: false`; static argv; no browser-provided commands, flags, paths, or environment variables |
| A supposedly passive probe mutates state | Probe allowlist and review; empty temp cwd; no updater/login/IDE commands; regression fixture and side-effect test where feasible |
| Probe hangs or floods output | Per-step timeout, abort, bounded concurrency, stdout/stderr byte limits, child termination grace |
| Secret leakage in stderr, paths, or manifests | Central sanitizer; replace home roots; redact auth-like values, URLs/query strings, bearer/key patterns, and control characters; never expose raw output |
| Credential-file scraping | Do not read keychains, auth stores, `.env`, IDE global state, SQLite stores, or generic harness configs that may contain keys |
| Malicious extension manifest or symlink | Approved roots, `lstat` plus `realpath`, regular-file requirement, size cap, identity validation, path containment check |
| Cross-user Windows profile exposure | Resolve only active/configured Windows home; never glob all user profiles; omit raw username from API |
| SSRF through update checking | Source-controlled HTTPS allowlist; no request URL input; redirect policy restricted to approved host; response size/time/schema limits |
| Supply-chain compromise or malicious release | Metadata only; no download/execution; official link shown for human inspection; no automatic trust from newer version |
| Refresh denial of service | Authentication, single-flight scan, bounded detector concurrency, 10-second cooldown |
| UI promotes catalog-only surface | `selectable` computed server-side from immutable capability policy; UI cannot override it; runner still validates adapters on race creation |
| Discovery triggers paid inference | No prompt-bearing command; no inference endpoint; tests assert exact argv; live model tests remain opt-in and separate |
| Stored XSS from manifest/model text | React text rendering; length/control-character normalization; no raw HTML; strict CSP retained |
| Race/catalog race condition | Immutable generation snapshots; race stores exact contestant config at creation; refresh never mutates active race |
| Network privacy leakage | Offline switch; no source/model/path payload; document that update checks expose ordinary network metadata |

### 13.4 Safety gates for runnable adapters

A catalog-only integration can become `verified-runnable` only when a reviewed change includes:

1. exact official repository and documentation provenance;
2. stable non-interactive invocation and structured-output contract;
3. explicit tool, MCP, extension, skill, context, session, and workspace isolation where the harness supports them;
4. no auto-approval or permission-bypass flag;
5. `spawnCli` with static argv, `shell: false`, empty temporary cwd, timeout, abort, and bounded output;
6. a sanitized real output fixture;
7. tests for argv safety, attempted tool use, model mismatch, non-zero exit, timeout, malformed output, and secret redaction;
8. an observed harmless filesystem side-effect probe performed manually and documented before enablement;
9. documentation of authentication, cost behavior, limitations, and blocked flags;
10. security review before changing the registry support level.

Forbidden patterns include `--yolo`, `--trust-all-tools`, `--dangerously-*`, `bypassPermissions`, blanket auto-approve, or equivalent behavior. A harness that cannot disable tools must remain catalog-only or later run inside a separately designed and reviewed container/micro-VM boundary.

## 14. Error handling and observability

- Every detector returns structured evidence or a typed failure code.
- Public warnings use stable codes and sanitized messages.
- The runner may log detector duration, status code, generation, and sanitized harness ID. It must not log raw manifest content, raw command output, tokens, or complete local paths.
- Missing optional IDE roots are normal, not warnings.
- Authentication failures map to `login-required` only when a parser recognizes a fixture-covered, non-secret signal; otherwise they map to `discovery-failed`.
- Unknown output never becomes model data.
- A previous valid snapshot remains available after a failed manual refresh, with a warning describing staleness.

## 15. Documentation deliverables

Create:

- `docs/harnesses/README.md`: capability matrix, status meanings, catalog workflow, offline mode, and links.
- `docs/harnesses/pi.md`
- `docs/harnesses/kiro.md`
- `docs/harnesses/hermes.md`
- `docs/harnesses/codex.md`
- `docs/harnesses/claude-code.md`
- `docs/harnesses/gemini-cli.md`
- `docs/harnesses/opencode.md`
- `docs/harnesses/aider.md`
- `docs/harnesses/ide-integrations.md`: Continue, Cline, Roo Code, IDE roots, and catalog-only semantics.
- `docs/harnesses/adding-a-harness.md`: detector and adapter contribution gate.
- `docs/security/discovery-threat-model.md`: expanded operational threat model and privacy notes.

Each harness guide includes:

- official repository/documentation links and evidence date;
- supported surfaces and current Rubik Arena support level;
- installation link or upstream command shown as documentation only;
- authentication method without requesting or storing credentials;
- passive evidence Rubik Arena reads or executes;
- exact model discovery capability and its limitations;
- verified safe benchmark invocation when runnable;
- explicitly forbidden flags/modes;
- WSL, Windows-host, Linux, and macOS troubleshooting relevant to that harness;
- environment override names where supported;
- cost warning and statement that discovery does not run a model.

The root `README.md`, `docs/adding-a-model.md`, `SECURITY.md`, and `docs/operations/PROJECT-MEMORY.md` will link to the new material and accurately distinguish observed behavior from planned or catalog-only support.

## 16. Testing strategy

All implementation follows red-green-refactor. Tests use fake binaries, temporary directories, recorded sanitized fixtures, and local fake HTTP servers. They do not call real models.

### 16.1 Discovery package

- Environment classification: Linux, macOS, WSL, active Windows host unavailable/configured.
- PATH resolution: missing, duplicate, non-executable, symlink, shadowed binary, sanitized location.
- IDE roots: approved root, unknown extension, malformed manifest, oversized file, escaping symlink, mixed case, duplicate installation.
- Pi and Kiro model parsers: valid fixtures, empty list, malformed output, duplicate IDs, nested Pi IDs, output limit.
- Capability mapping: catalog-only evidence can never set `selectable: true`.
- Sanitizer: POSIX home, Windows profile, bearer token, key-like value, URL query, ANSI/control characters.
- Release checker: approved host, redirects, rate limit, malformed schema, oversized body, timeout, prerelease, version normalization, offline mode.

### 16.2 Runner

- Initial background scan and `GET /api/discovery` behavior.
- Auth and Host guard on every discovery route.
- Manual refresh returns `202`, joins an in-flight scan, increments generation once, and enforces the 10-second cooldown.
- Partial detector failure preserves successful results.
- Failed refresh retains the previous snapshot.
- Request bodies/query strings cannot choose commands, paths, or URLs.
- Existing adapter/model endpoints remain compatible.

### 16.3 Web

- Pure grouping, filtering, search, update, and stale-model helpers.
- Loading, ready, partial, failed, offline, empty, login-required, catalog-only, and update states.
- Add-contestant is rendered only for selectable routes and copies exact route data.
- Refresh busy state prevents duplicate UI submissions.
- Disappearing model retains an existing contestant and shows a warning.
- Keyboard and accessible-name assertions for controls and status.
- Untrusted labels render as text.

### 16.4 Verification

Run:

```bash
npm run check
```

This covers Biome, TypeScript project references, Vitest, and the production Vite build. Do not run `npm run test:e2e` unless the user separately authorizes a real model run and its cost.

## 17. Rollout

Implement in vertical slices:

1. Discovery domain, registry, safe local CLI/environment detection, and snapshot API.
2. Pi/Kiro model catalog integration and compatibility with existing model endpoints.
3. Dashboard catalog, refresh, filters, and add-contestant flow.
4. WSL active-Windows-host and IDE manifest detection.
5. Optional allowlisted release metadata and offline mode.
6. Harness usage, connector contribution, and threat-model documentation.

A slice is not complete until its tests pass. Catalog-only integrations may ship incrementally; runnable status changes require their own reviewed adapter work and are not implied by this initiative.

## 18. Primary upstream references

These references identify candidate official surfaces. Exact commands, package IDs, extension IDs, and release semantics must be rechecked against the linked upstream at implementation time and captured in the corresponding harness guide.

- Pi coding agent: https://github.com/earendil-works/pi
- OpenAI Codex: https://github.com/openai/codex
- Kiro: https://github.com/kirodotdev/Kiro and https://kiro.dev
- Claude Code: https://github.com/anthropics/claude-code
- Gemini CLI: https://github.com/google-gemini/gemini-cli
- OpenCode: https://github.com/anomalyco/opencode
- Aider: https://github.com/Aider-AI/aider and https://aider.chat
- Continue: https://github.com/continuedev/continue and https://docs.continue.dev
- Cline: https://github.com/cline/cline
- Roo Code: https://github.com/RooCodeInc/Roo-Code
- Hermes Agent: https://github.com/NousResearch/hermes-agent

## 19. Acceptance checklist

- Runtime discovery never modifies curated presets or another harness.
- Startup and manual refresh work without polling.
- Pi/Kiro newly listed models appear without a Rubik Arena source change.
- IDEs are detected without launching them.
- WSL scans only the active/configured Windows profile.
- Catalog-only evidence cannot become runnable through API or UI input.
- No discovery path sends a prompt or consumes model credits.
- Offline mode makes no outbound request.
- Update metadata cannot install or execute anything.
- All public errors and locations are sanitized.
- Existing adapter, preset, race, and demo behavior stays compatible.
- User and contributor documentation states observed, verified, and unverified capabilities accurately.
- `npm run check` passes.
