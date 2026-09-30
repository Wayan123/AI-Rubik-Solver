# Automatic Harness and Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passive, security-first discovery of supported CLI and IDE harnesses, their model catalogs, versions, and official update metadata to the local Rubik Arena dashboard.

**Architecture:** A typed discovery package beside the adapter registry gathers bounded local evidence under an immutable capability policy. A runner-owned single-flight service schedules scans and exposes authenticated snapshots; the React dashboard renders those server decisions and can populate, but never start, a verified contestant. File-only IDE detection, allowlisted release lookups, and documentation are added as later slices without changing the race execution path.

**Tech Stack:** TypeScript 5.9, Node.js ≥22 filesystem/process APIs, Fastify 5, React 19, Vitest 5, Biome 2, Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-30-automatic-harness-model-discovery-design.md`

## Global Constraints

- Discovery runs at runner startup and by authenticated manual refresh; there is no polling.
- Discovery must not send model prompts, consume credits, install/update software, log in, modify harness configuration, or launch an IDE.
- `config/contestants.json` remains curated and is never written by discovery.
- Runtime commands, arguments, filesystem roots, repository coordinates, URLs, extension IDs, and capability levels come only from source-controlled definitions—not browser input.
- All child processes use static argv, `shell: false`, bounded output, timeout/abort, and an empty temporary working directory.
- IDE detection is file-only. Do not read keychains, authentication files, `.env`, IDE global-state/SQLite databases, histories, telemetry, or logs.
- WSL scans only the active or explicitly configured Windows home; never glob all `/mnt/c/Users/*` profiles.
- Catalog evidence cannot promote a harness to runnable; `selectable` is computed from immutable server-side capability policy.
- Update checks are metadata-only, HTTPS allowlisted, prerelease-excluding, cached, optional, and disabled by `RUBIK_DISCOVERY_OFFLINE=1`.
- No new dependency is expected. If implementation proves one necessary, pause for user approval and pin it exactly.
- Preserve loopback binding, bearer-token authentication, Host guard, no-CORS policy, CSP, adapter validation, and existing model/preset/race APIs.
- Never use `--yolo`, `--trust-all-tools`, `--dangerously-*`, `bypassPermissions`, blanket auto-approval, or equivalents.
- Do not run `npm run test:e2e`; it invokes real models and may consume credits.
- Do not create commits unless the user separately and explicitly requests them.

## Review Focus

- A malicious PATH entry named like a supported CLI must not gain benchmark capability or supply browser-controlled execution arguments; Task 2 pins static registry policy and path handling.
- A manifest symlink escaping an approved IDE root must be rejected rather than followed; Task 5 pins containment and file-size behavior.
- A detector error containing a home path, Windows username, token, key-like value, URL query, ANSI sequence, or control character must be sanitized before API/UI exposure; Task 1 pins redaction.
- Concurrent or repeated refresh requests must not start duplicate scans or bypass the 10-second cooldown; Task 3 pins single-flight and rate behavior.
- Update redirects or responses must not escape the approved host, consume unbounded data, or turn prereleases/unknown versions into update claims; Task 6 pins network behavior.

---

## File Structure

### New production files

- `packages/adapters/src/discovery/types.ts` — public discovery types and detector contracts.
- `packages/adapters/src/discovery/sanitize.ts` — bounded strings and secret/path/control-character redaction.
- `packages/adapters/src/discovery/files.ts` — safe `lstat`/`realpath`/size/containment utilities.
- `packages/adapters/src/discovery/environment.ts` — OS, WSL, PATH, executable, and active Windows-home resolution.
- `packages/adapters/src/discovery/registry.ts` — reviewed harness definitions and immutable support policy.
- `packages/adapters/src/discovery/scan.ts` — bounded detector orchestration, normalization, deduplication, and partial-failure behavior.
- `packages/adapters/src/discovery/releases.ts` — injected-fetch official release metadata checker.
- `packages/adapters/src/discovery/index.ts` — discovery exports.
- `apps/runner/src/discovery.ts` — snapshot lifecycle, generations, single-flight scans, previous-snapshot retention, and cooldown.
- `apps/web/src/discovery.ts` — pure grouping, filtering, stale-model, and contestant-draft helpers.
- `apps/web/src/components/HarnessCatalog.tsx` — accessible catalog, search/filter, refresh, and add-contestant UI.

### New tests and fixtures

- `packages/adapters/test/discovery.test.ts` — environment, scanner, registry, sanitization, filesystem, model, and release tests.
- `packages/adapters/test/fixtures/discovery/pi-models.txt` — sanitized Pi list fixture, including a newly introduced model ID.
- `packages/adapters/test/fixtures/discovery/kiro-models.json` — sanitized Kiro list fixture.
- `apps/runner/test/discovery.test.ts` — `DiscoveryService` and API lifecycle/security tests.
- `apps/web/test/discovery.test.ts` — pure catalog and contestant-draft behavior tests.

### Existing production files to modify

- `packages/adapters/src/index.ts` — export discovery package.
- `packages/adapters/src/registry.ts` — share audited Pi/Kiro model probes instead of duplicating discovery logic.
- `packages/adapters/src/spawn.ts` — support bounded stdout if the red test proves current unbounded collection violates the spec.
- `apps/runner/src/index.ts` — export `DiscoveryService`.
- `apps/runner/src/main.ts` — construct service and start background scan after loopback listen.
- `apps/runner/src/server.ts` — inject service and add authenticated discovery routes.
- `apps/web/src/api.ts` — discovery API types/client methods.
- `apps/web/src/App.tsx` — fetch snapshot, refresh, add discovered contestant, stale warnings, and mount catalog.
- `apps/web/src/components/ContestantEditor.tsx` — accept and show latest-catalog staleness without deleting the draft.
- `apps/web/src/styles.css` — responsive catalog layout and text-bearing statuses.

### Documentation to create or modify

- Create `docs/harnesses/README.md`.
- Create `docs/harnesses/pi.md`.
- Create `docs/harnesses/kiro.md`.
- Create `docs/harnesses/hermes.md`.
- Create `docs/harnesses/codex.md`.
- Create `docs/harnesses/claude-code.md`.
- Create `docs/harnesses/gemini-cli.md`.
- Create `docs/harnesses/opencode.md`.
- Create `docs/harnesses/aider.md`.
- Create `docs/harnesses/ide-integrations.md`.
- Create `docs/harnesses/adding-a-harness.md`.
- Create `docs/security/discovery-threat-model.md`.
- Modify `README.md`.
- Modify `docs/adding-a-model.md`.
- Modify `SECURITY.md`.
- Modify `docs/operations/PROJECT-MEMORY.md` only after verification, recording observed results rather than planned claims.

---

### Task 1: Typed Discovery Core and Public-Output Sanitization

**Files:**
- Create: `packages/adapters/src/discovery/types.ts`
- Create: `packages/adapters/src/discovery/sanitize.ts`
- Create: `packages/adapters/src/discovery/index.ts`
- Modify: `packages/adapters/src/index.ts`
- Test: `packages/adapters/test/discovery.test.ts`

**Interfaces:**
- Produces: all exact types in spec §5.2, plus `HarnessDefinition`, `HarnessDetector`, `DiscoveryContext`, and `HarnessDetection`.
- Produces: `sanitizeDiscoveryText(value: string, roots?: readonly string[]): string`.
- Produces: `boundedText(value: string, maxBytes: number): string`.
- Invariant: public types contain no raw command output, credential values, or unsanitized local paths.

- [ ] **Step 1: Write failing tests for the public type helpers and sanitizer**

Add tests named:

```ts
it("redacts POSIX and Windows home roots from public discovery messages", () => {
  expect(sanitizeDiscoveryText("failed in /home/alice/.pi and C:\\Users\\Alice\\.codex", [
    "/home/alice",
    "C:\\Users\\Alice",
  ])).toBe("failed in <HOME>/.pi and <HOME>/.codex");
});

it("redacts bearer tokens, key-like assignments, URL queries, ANSI and control characters", () => {
  const input = "\u001b[31mAuthorization: Bearer abc.def api_key=sk-secret https://x.test/a?t=secret\u0000";
  const out = sanitizeDiscoveryText(input);
  expect(out).not.toMatch(/abc\.def|sk-secret|secret|\u001b|\u0000/);
  expect(out).toContain("<REDACTED>");
});

it("bounds public output by UTF-8 byte length", () => {
  expect(Buffer.byteLength(boundedText("é".repeat(100), 32))).toBeLessThanOrEqual(32);
});
```

The production change that makes these pass is a central sanitizer used at every detector-to-API boundary.

- [ ] **Step 2: Run the targeted tests and verify RED**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts
```

Expected: FAIL because the discovery exports and sanitizer do not exist.

- [ ] **Step 3: Implement the exact discovery domain types and bounded sanitizer**

Keep status unions and field names identical to spec §5.2. Normalize path separators before replacing configured home roots. Strip ANSI/control characters before redaction, cap the final UTF-8 output, and use conservative patterns for authorization/key/query values.

- [ ] **Step 4: Export the discovery package**

Export from `packages/adapters/src/discovery/index.ts` and then `packages/adapters/src/index.ts`. Do not expose detector internals that accept arbitrary commands.

- [ ] **Step 5: Run targeted tests and adapter typecheck**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts
npx tsc -b packages/adapters
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Review only Task 1's diff for sanitizer over-redaction/under-redaction, exact type names, and accidental secret-bearing fields. Do not commit unless separately authorized.

---

### Task 2: Local CLI Registry, Environment Resolution, and Pi/Kiro Model Catalog

**Files:**
- Create: `packages/adapters/src/discovery/environment.ts`
- Create: `packages/adapters/src/discovery/registry.ts`
- Create: `packages/adapters/src/discovery/scan.ts`
- Create: `packages/adapters/test/fixtures/discovery/pi-models.txt`
- Create: `packages/adapters/test/fixtures/discovery/kiro-models.json`
- Modify: `packages/adapters/src/discovery/index.ts`
- Modify: `packages/adapters/src/registry.ts`
- Modify: `packages/adapters/src/spawn.ts`
- Test: `packages/adapters/test/discovery.test.ts`
- Test: `packages/adapters/test/adapters.test.ts`

**Interfaces:**
- Consumes: Task 1 discovery types and sanitizer.
- Produces: `classifyEnvironment(platform: NodeJS.Platform, release: string, versionText?: string): EnvironmentKind`.
- Produces: `resolvePathExecutables(names: readonly string[], pathValue: string, fs: DiscoveryFs): Promise<ResolvedExecutable[]>`.
- Produces: `HARNESS_DEFINITIONS: readonly HarnessDefinition[]`.
- Produces: `scanDiscovery(context: DiscoveryContext): Promise<Omit<DiscoverySnapshot, "generation" | "state" | "startedAt" | "completedAt">>`.
- Produces: shared `probeAdapterModels(adapterId: string, search?: string): Promise<string[]>`, used by both legacy endpoint logic and discovery.
- Invariant: only Pi, Kiro CLI, and Hermes carry `verified-runnable`; other initial definitions are `catalog-only` or `blocked`.

- [ ] **Step 1: Add failing environment and PATH-resolution tests**

Cover:

```ts
it.each([
  ["linux", "6.8.0", "", "linux"],
  ["darwin", "24.0.0", "", "macos"],
  ["linux", "6.8.0-microsoft-standard-WSL2", "", "wsl"],
])("classifies %s %s as %s", ...);

it("resolves regular executable files in PATH order and deduplicates real paths", async () => { /* temp dirs */ });
it("ignores missing, non-executable, directory, and broken-link candidates", async () => { /* temp dirs */ });
it("keeps a shadowed binary as evidence but does not change registry capability", async () => { /* assertions */ });
```

- [ ] **Step 2: Add failing registry-policy tests**

Assert exact source-controlled policy:

```ts
expect(definition("pi")).toMatchObject({ supportLevel: "verified-runnable", adapterId: "pi" });
expect(definition("kiro-cli")).toMatchObject({ supportLevel: "verified-runnable", adapterId: "kiro-cli" });
expect(definition("hermes")).toMatchObject({ supportLevel: "verified-runnable", adapterId: "hermes" });
for (const id of ["codex", "claude-code", "gemini-cli", "opencode", "aider", "continue", "cline", "roo-code"])
  expect(definition(id).supportLevel).toBe("catalog-only");
expect(HARNESS_DEFINITIONS.every((d) => d.documentationUrl.startsWith("https://"))).toBe(true);
```

Also assert that detector definitions expose no API accepting browser-supplied argv or URL.

- [ ] **Step 3: Add failing Pi/Kiro model scan tests**

Use fixtures containing duplicates, malformed rows, and a representative newly released ID such as `openai-codex/gpt-sol-6.1`. Assert:

```ts
expect(snapshot.models).toContainEqual(expect.objectContaining({
  modelId: "openai-codex/gpt-sol-6.1",
  adapterId: "pi",
  selectable: true,
  source: "live-cli",
}));
expect(snapshot.models.filter((m) => m.modelId === "openai-codex/gpt-sol-6.1")).toHaveLength(1);
expect(snapshot.models.every((m) => m.routeId.includes(m.harnessInstanceId))).toBe(true);
```

Add a failing test that a Codex binary produces installation evidence but no model-list child invocation and no selectable direct Codex model.

- [ ] **Step 4: Add a failing bounded-output test to `spawnCli` if current behavior is unbounded**

Exercise a fake CLI that prints beyond the configured stdout limit. The expected behavior is a clear `CliError` or bounded captured output, while preserving existing stream-line behavior. Add `stdoutLimitBytes?: number` to `SpawnCliOptions` only if required by this test.

- [ ] **Step 5: Run targeted tests and verify RED**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts packages/adapters/test/adapters.test.ts
```

Expected: FAIL because environment/registry/scanner behavior does not exist and stdout is currently unbounded.

- [ ] **Step 6: Implement environment classification and filesystem-based PATH resolution**

Use injected filesystem/process values in tests. Do not call `which`, `where`, or a shell. Record deterministic environment IDs and sanitized locations; never use a raw path as an ID.

- [ ] **Step 7: Implement immutable initial harness definitions**

Enable static version/model probes only where already observed and tested:

- Pi: configured binary or `pi`; `--version`; `--list-models`.
- Kiro CLI: configured binary or `kiro-cli`; `--version`; `chat --list-models --format json`.
- Hermes: configured binary or `hermes`; `--version`; no model-list command.
- Codex, Claude Code, Gemini CLI, OpenCode, Aider: installation/version evidence only in this slice.
- Continue, Cline, Roo Code: definitions only; IDE evidence arrives in Task 5.

Version and model commands are arrays fixed by the definition. Model discovery failure must not erase installation evidence.

- [ ] **Step 8: Implement bounded scanning and normalization**

Limit detector concurrency, enforce per-probe timeout, sanitize every warning/message, normalize model/provider IDs, deduplicate routes, and compute `selectable` solely from `supportLevel === "verified-runnable"`, matching adapter ID, and successful route evidence.

- [ ] **Step 9: Reuse audited Pi/Kiro probes in the legacy model endpoint**

Refactor `listModels`/the new `probeAdapterModels` so `/api/adapters/:id/models` and discovery cannot drift. Preserve existing search behavior and existing adapter tests.

- [ ] **Step 10: Run targeted tests, adapter suite, and typecheck**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts packages/adapters/test/adapters.test.ts
npx tsc -b packages/adapters
```

Expected: PASS with no real CLI invocation in tests.

- [ ] **Step 11: Review checkpoint**

Confirm exact argv, no prompt-bearing command, no Codex model-list invention, no capability promotion from discovered evidence, and no unbounded output. Do not commit unless separately authorized.

---

### Task 3: Runner DiscoveryService and Authenticated Snapshot API

**Files:**
- Create: `apps/runner/src/discovery.ts`
- Create: `apps/runner/test/discovery.test.ts`
- Modify: `apps/runner/src/index.ts`
- Modify: `apps/runner/src/server.ts`
- Modify: `apps/runner/src/main.ts`
- Test: `apps/runner/test/runner.test.ts`

**Interfaces:**
- Consumes: `scanDiscovery(context)` and `DiscoverySnapshot` from Task 2.
- Produces: `class DiscoveryService` with:

```ts
constructor(options: {
  scan: () => Promise<DiscoveryScanResult>;
  now?: () => number;
  cooldownMs?: number;
  offline: boolean;
});
getSnapshot(): DiscoverySnapshot;
ensureStarted(): Promise<DiscoverySnapshot>;
refresh(): Promise<{ accepted: true; snapshot: DiscoverySnapshot } | { accepted: false; retryAfterMs: number }>;
```

- Produces: `buildServer` option `discovery?: DiscoveryService`.
- Produces: `GET /api/discovery`, `POST /api/discovery/refresh`, `GET /api/discovery/status`.
- Invariant: cooldown is exactly 10,000 ms from scan start; concurrent callers join one scan; previous usable data survives refresh failure.

- [ ] **Step 1: Write failing service lifecycle tests**

Tests must assert:

```ts
it("starts one generation and shares it across concurrent callers", async () => {
  const [a, b] = await Promise.all([service.ensureStarted(), service.ensureStarted()]);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(a.generation).toBe(1);
  expect(b.generation).toBe(1);
});

it("returns prior catalog with scanning state during refresh", async () => { /* deferred scan */ });
it("marks a mixed scan partial without dropping successful harnesses", async () => { /* result */ });
it("retains the prior completed snapshot after a failed refresh", async () => { /* reject */ });
it("rejects refresh inside the 10000 ms cooldown with retryAfterMs", async () => { /* fake clock */ });
```

- [ ] **Step 2: Write failing API security and contract tests**

Use Fastify injection to assert:

- all three discovery routes require bearer token and valid loopback Host;
- `GET /api/discovery` returns `200` with state in the body;
- first GET starts at most one scan;
- accepted refresh returns `202`;
- cooldown returns `429` and `retry-after`;
- status response omits harness/model arrays;
- request body/query cannot supply command/path/URL behavior;
- existing health, adapter, model, preset, and race endpoints remain compatible.

- [ ] **Step 3: Run runner tests and verify RED**

Run:

```bash
npx vitest run apps/runner/test/discovery.test.ts apps/runner/test/runner.test.ts
```

Expected: FAIL because service/routes do not exist.

- [ ] **Step 4: Implement `DiscoveryService` as a deterministic state machine**

Use immutable snapshot replacement and one stored in-flight promise. Convert unexpected scan failure to sanitized public warning/state. Inject clock and scanner for tests; do not use module-level mutable singleton state.

- [ ] **Step 5: Add routes and dependency injection to `buildServer`**

If no service is supplied in existing tests, use a harmless disabled/idle service or leave routes unavailable only where tests explicitly inject it; production `main.ts` must always inject one. Do not weaken the existing auth hook.

- [ ] **Step 6: Start production discovery after loopback listen**

Construct the scan context from runner environment. Read `RUBIK_DISCOVERY_OFFLINE === "1"`. Start `ensureStarted()` without blocking successful server listen; handle rejection through service state, not an unhandled promise.

- [ ] **Step 7: Run runner/adapters tests and typecheck**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts apps/runner/test/discovery.test.ts apps/runner/test/runner.test.ts
npx tsc -b packages/adapters apps/runner
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint**

Trace authorization, generation transitions, failed-refresh retention, cooldown math, and absence of raw errors. Do not commit unless separately authorized.

---

### Task 4: Dashboard Catalog, Refresh, and Add-Contestant Flow

**Files:**
- Create: `apps/web/src/discovery.ts`
- Create: `apps/web/src/components/HarnessCatalog.tsx`
- Create: `apps/web/test/discovery.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/ContestantEditor.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: exact Task 1 API types, mirrored or imported from a browser-safe source without pulling Node-only modules into the bundle.
- Produces: `filterDiscovery(snapshot, query, statuses): DiscoveryView`.
- Produces: `contestantFromDiscoveredModel(model, harness, id): ContestantConfig`.
- Produces: `isContestantStale(contestant, snapshot): boolean`.
- Produces: `RunnerApi.discovery()`, `RunnerApi.discoveryStatus()`, and `RunnerApi.refreshDiscovery()`.
- Produces: `HarnessCatalog` props with snapshot, busy/error state, `onRefresh`, and `onAddModel`.

- [ ] **Step 1: Write failing pure behavior tests**

Cover:

```ts
it("groups models by environment, harness instance, and provider", () => { /* exact order */ });
it("searches case-insensitively across model, provider, and harness", () => { /* results */ });
it("filters Ready, Login required, Catalog only, Unavailable, Discovery failed, and Updates", () => {});
it("creates a contestant only from a selectable model and preserves exact adapter/model IDs", () => {
  expect(contestantFromDiscoveredModel(model, harness, "new-id")).toMatchObject({
    id: "new-id",
    adapter: "pi",
    model: "openai-codex/gpt-sol-6.1",
    mode: "interactive",
  });
});
it("rejects add-contestant conversion for catalog-only routes", () => {});
it("marks an existing configured model stale without deleting it", () => {});
```

- [ ] **Step 2: Write failing API client tests or test the request seam through injected fetch**

Assert `POST /api/discovery/refresh` and authenticated GET paths are exact. If current `RunnerApi` is not testable without global mutation, minimally inject `fetch` into its constructor with browser `fetch` as the default.

- [ ] **Step 3: Run web tests and verify RED**

Run:

```bash
npx vitest run apps/web/test/discovery.test.ts apps/web/test/state.test.ts
```

Expected: FAIL because catalog helpers/client methods do not exist.

- [ ] **Step 4: Implement pure view helpers and client methods**

Treat all labels as plain text. Keep sort order deterministic. Never infer selectability in the browser beyond honoring the server's false value; the conversion helper must throw/refuse when `selectable` or `adapterId` is missing.

- [ ] **Step 5: Implement accessible `HarnessCatalog`**

Render scan state, last-completed time, search, filters, environment/harness groups, text-bearing status badges, versions, safe external documentation/release links, model lists, and **Add contestant** only for selectable models. Use `aria-live="polite"`, `aria-busy`, keyboard-native controls, and no raw HTML.

- [ ] **Step 6: Integrate snapshot and refresh state into `App.tsx`**

On authenticated runner connection, fetch discovery alongside adapters/presets. Refresh must update busy/error state and then read the current snapshot/status until the accepted generation completes without periodic background polling; a short request-scoped completion wait is allowed only after a user click. Mount the panel without preventing race setup when discovery is partial/failed.

- [ ] **Step 7: Add discovered contestant and stale warning**

Reuse existing `newId()` and default timeout/turn values. Adding never starts a race. Pass staleness into `ContestantEditor`; show **Not present in latest catalog** while retaining the user's draft.

- [ ] **Step 8: Add responsive styles**

Keep the existing visual language. Ensure the panel works at 320 px, avoids horizontal overflow, and uses text plus color for statuses. Do not add decorative motion or generic marketing copy.

- [ ] **Step 9: Run web tests, typecheck, and build**

Run:

```bash
npx vitest run apps/web/test/discovery.test.ts apps/web/test/state.test.ts apps/web/test/replay.test.ts
npx tsc -b apps/web
npm run build
```

Expected: PASS.

- [ ] **Step 10: Browser smoke test without real models**

Start the runner with fixture/injected discovery data or use the tested local environment, open the authenticated dashboard, and verify:

- scan status and harness cards render;
- refresh has a busy state;
- a selectable fixture model can be added but no race starts;
- catalog-only harness has no add button;
- mobile-width layout does not overflow;
- browser console has no error.

Do not press **Start race** for an LLM contestant.

- [ ] **Step 11: Review checkpoint**

Review UI against spec, accessibility, untrusted-string rendering, and existing race flow. Do not commit unless separately authorized.

---

### Task 5: Safe WSL Windows-Host and IDE Manifest Detection

**Files:**
- Create: `packages/adapters/src/discovery/files.ts`
- Modify: `packages/adapters/src/discovery/environment.ts`
- Modify: `packages/adapters/src/discovery/registry.ts`
- Modify: `packages/adapters/src/discovery/scan.ts`
- Test: `packages/adapters/test/discovery.test.ts`

**Interfaces:**
- Consumes: Task 1 sanitizer/types and Task 2 registry/scanner.
- Produces: `safeReadJsonManifest(path, approvedRoot, options): Promise<Record<string, unknown> | null>`.
- Produces: `resolveWindowsHostHome(context): Promise<ResolvedWindowsHome | null>`.
- Produces: file-only surface detections for verified extension/product IDs.
- Invariant: no IDE executable is launched; no broad Windows-user glob; no global-state/auth/config database is read.

- [ ] **Step 1: Write failing safe-file tests**

Use temporary directories to assert:

- valid bounded regular `package.json` inside approved root succeeds;
- malformed JSON returns typed failure;
- a file over the exact implementation cap is rejected;
- a symlink whose real path escapes the root is rejected;
- a symlink contained inside the root follows only if policy explicitly permits it; default is reject;
- directory/device/non-regular input is rejected;
- manifest-declared ID mismatch is rejected;
- mixed-case extension folder is matched only after declared identity validation.

- [ ] **Step 2: Write failing WSL privacy tests**

Assert:

```ts
it("uses RUBIK_WINDOWS_HOME when configured and contained under an allowed mount", () => {});
it("skips Windows-host discovery when active home cannot be determined uniquely", () => {});
it("never enumerates every /mnt/c/Users child", () => {
  expect(fs.readdirCalls).not.toContain("/mnt/c/Users");
});
it("does not execute IDE binaries while detecting versions", () => {
  expect(spawn).not.toHaveBeenCalledWith(expect.stringMatching(/code|cursor|windsurf|kiro/i), expect.anything());
});
```

- [ ] **Step 3: Write failing IDE registry tests from primary-source evidence**

Before enabling each literal, re-open its official repository/manifest and record the evidence URL/date in the matching `docs/harnesses/*.md` draft. Assert exact approved extension IDs for only those that can be verified. Unknown IDs are omitted, not guessed.

Test native Linux/macOS extension roots plus WSL active Windows-host roots for supported VS Code-family installations. Assert duplicates normalize to distinct environment/surface instances only when genuinely distinct.

- [ ] **Step 4: Run discovery tests and verify RED**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts
```

Expected: FAIL because safe manifest/Windows-host detection does not exist.

- [ ] **Step 5: Implement safe file primitives**

Use `lstat`, `realpath`, path-relative containment checks, regular-file validation, explicit maximum bytes, UTF-8 parsing, and typed sanitized errors. Never recursively scan beyond one bounded extension-root level and its expected manifest file.

- [ ] **Step 6: Implement active/configured Windows-home resolution**

Prefer `RUBIK_WINDOWS_HOME`. If an internal fixed Windows interop probe is necessary, keep its command and argv static and fixture-test its output; accept only a single absolute profile path that maps to an allowed mounted drive. Failure skips host discovery.

- [ ] **Step 7: Implement file-only IDE/extension detectors**

Read product/package manifests only. Do not execute `code --version` or equivalents. Do not inspect `globalStorage`, SQLite, settings-sync, auth, histories, logs, `.env`, or workspace marker files.

- [ ] **Step 8: Run targeted/full adapter tests and typecheck**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts packages/adapters/test/adapters.test.ts
npx tsc -b packages/adapters
```

Expected: PASS.

- [ ] **Step 9: Review checkpoint**

Manually trace every filesystem root to its source-controlled definition and every resolved path through containment checks. Confirm no all-users glob and no IDE process launch. Do not commit unless separately authorized.

---

### Task 6: Allowlisted Official Release Metadata and Offline Mode

**Files:**
- Create: `packages/adapters/src/discovery/releases.ts`
- Modify: `packages/adapters/src/discovery/registry.ts`
- Modify: `packages/adapters/src/discovery/scan.ts`
- Modify: `packages/adapters/src/discovery/index.ts`
- Test: `packages/adapters/test/discovery.test.ts`

**Interfaces:**
- Consumes: source-controlled `releaseSource` definitions and discovered local versions.
- Produces: `checkHarnessUpdate(definition, currentVersion, options): Promise<HarnessUpdate | undefined>`.
- Produces: `normalizeComparableVersion(value: string): ComparableVersion | null`.
- Options include injected `fetch`, timeout, byte cap, and `offline`.
- Invariant: only approved HTTPS host/owner/repository combinations can be requested; prereleases never produce an update.

- [ ] **Step 1: Write failing version-comparison tests**

Cover `v1.2.3`, package-prefixed output such as `codex-cli 0.159.1`, equal/older/newer versions, malformed versions, and prerelease tags. Unknown schemes return `null`, not an update claim.

- [ ] **Step 2: Write failing fake-server/fetch tests**

Assert:

- offline mode makes zero fetch calls;
- only registry-approved `https://api.github.com/repos/<owner>/<repo>/releases/latest` is accepted;
- user/browser values cannot alter owner/repository/host;
- prerelease/draft is ignored;
- timeout, 403/429, malformed JSON, and oversized body become sanitized warnings without degrading local discovery;
- redirect to a different host is rejected;
- no request body contains paths, model IDs, source, or configuration;
- one runner-generation check is cached/deduplicated.

- [ ] **Step 3: Run targeted tests and verify RED**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts
```

Expected: FAIL because release checking does not exist.

- [ ] **Step 4: Verify each enabled release source against the installed artifact**

Enable a source only when the official repository's release tags correspond to the detected CLI/IDE artifact. Omit release checking for feedback-only repositories, marketplace-only artifacts, ambiguous forks, or mismatched package versions.

- [ ] **Step 5: Implement metadata-only checker**

Use injected `fetch`, `redirect: "manual"`, an abort timeout, streamed byte limit, strict field parsing, safe version comparison, and runner-lifetime caching. Send no auth token. A standard non-identifying `User-Agent` is acceptable if GitHub requires it.

- [ ] **Step 6: Integrate update data as optional enrichment**

Local harness/model results must be complete before network enrichment. Network failure adds a warning only. Preserve `RUBIK_DISCOVERY_OFFLINE=1` from Task 3 through the scan context.

- [ ] **Step 7: Run targeted tests and package/runner typecheck**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts apps/runner/test/discovery.test.ts
npx tsc -b packages/adapters apps/runner
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint**

Inspect every possible URL construction, redirect path, response bound, and version claim. Confirm metadata cannot trigger installation or execution. Do not commit unless separately authorized.

---

### Task 7: Harness Usage Guides, Connector Gate, and Discovery Threat Model

**Files:**
- Create all documentation listed under File Structure.
- Modify: `README.md`
- Modify: `docs/adding-a-model.md`
- Modify: `SECURITY.md`
- Modify after verification: `docs/operations/PROJECT-MEMORY.md`

**Interfaces:**
- Consumes: implemented registry literals, observed tests, spec, and primary upstream sources.
- Produces: one consistent support matrix and safe user/contributor workflow.
- Invariant: documentation distinguishes **observed**, **verified by upstream**, **inferred**, and **unverified**. It never claims a catalog-only harness can run a benchmark.

- [ ] **Step 1: Draft the top-level usage and capability matrix**

`docs/harnesses/README.md` must explain:

- startup discovery and manual refresh;
- status/support meanings;
- adding a discovered model versus curated preset;
- no prompt/cost during discovery;
- offline mode;
- exact initial harness matrix from the implemented registry;
- links to every harness guide.

- [ ] **Step 2: Write runnable-harness guides**

For Pi, Kiro CLI, and Hermes, document official upstream, install/login references, exactly what Rubik Arena probes, safe benchmark argv behavior, model discovery limitations, binary overrides, costs, troubleshooting, and forbidden flags. Keep observed local versions/results dated.

- [ ] **Step 3: Write catalog-only harness guides**

For Codex, Claude Code, Gemini CLI, OpenCode, Aider, Continue, Cline, and Roo Code/IDE integrations, record official repository/docs, detected surfaces, what is deliberately not read/run, and what evidence is still required before verified execution. Do not copy unverified commands from search summaries.

- [ ] **Step 4: Write `adding-a-harness.md` as a hard contribution gate**

Require provenance, license/security inspection, source-controlled definition, no runtime plugin loading, typed detector, sanitized fixture, safe argv, no auto-approval, side-effect probe, malformed/timeout/secret tests, user guide, and security review. Include a checklist for moving `catalog-only` to `verified-runnable`.

- [ ] **Step 5: Write the expanded threat model**

`docs/security/discovery-threat-model.md` must cover assets, trust boundaries, attacker capabilities, PATH shadowing, malicious manifests/symlinks, cross-user WSL privacy, SSRF/redirects, supply-chain metadata, secret/error leakage, refresh abuse, paid-inference prevention, catalog-to-execution privilege separation, residual risks, and incident reporting.

- [ ] **Step 6: Update existing entry points**

Update root README, `docs/adding-a-model.md`, and `SECURITY.md` to link to the catalog, usage guides, offline mode, and contribution gate. Remove or qualify stale statements that imply every detected model/harness is runnable.

- [ ] **Step 7: Validate documentation against code and links**

Run local checks:

```bash
rg -n "verified-runnable|catalog-only|RUBIK_DISCOVERY_OFFLINE|Refresh harnesses" README.md SECURITY.md docs/harnesses docs/security docs/adding-a-model.md
rg -n -- "--yolo|--trust-all-tools|--dangerously-|bypassPermissions" docs/harnesses docs/security SECURITY.md
```

Manually confirm each enabled official URL and literal against the upstream primary source. Forbidden flags may appear only as warnings, never recommended commands.

- [ ] **Step 8: Update project memory with observed completion evidence**

Only after all code checks pass, update `docs/operations/PROJECT-MEMORY.md` with the actual test count, implemented harness statuses, known limitations, and date. Do not record planned support as complete.

- [ ] **Step 9: Review checkpoint**

Cross-check every guide against the actual registry and tests. Do not commit unless separately authorized.

---

### Task 8: Whole-Feature Verification and Security Review

**Files:**
- Review: every file changed in Tasks 1–7.
- Modify only if verification exposes a concrete defect; use a new failing regression test before each code fix.

**Interfaces:**
- Consumes: complete feature.
- Produces: evidence that the spec and repository quality gate pass.

- [ ] **Step 1: Run the complete offline quality gate**

Run:

```bash
npm run check
```

Expected: Biome, TypeScript, all Vitest tests, and production build PASS. Record the exact test count and build result. Do not run `npm run test:e2e`.

- [ ] **Step 2: Run focused security regressions again**

Run:

```bash
npx vitest run packages/adapters/test/discovery.test.ts apps/runner/test/discovery.test.ts apps/runner/test/runner.test.ts apps/web/test/discovery.test.ts
```

Expected: PASS.

- [ ] **Step 3: Inspect the diff for forbidden behavior and secrets**

Run:

```bash
git diff --check
rg -n "shell:\s*true|exec\(|execSync\(|spawnSync\(|curl\s|--yolo|--trust-all-tools|--dangerously-|bypassPermissions" packages/adapters/src apps/runner/src apps/web/src
rg -n "api[_-]?key\s*[:=]\s*['\"][^'\"]+|Bearer\s+[A-Za-z0-9._-]{12,}" . --glob '!node_modules/**' --glob '!apps/web/dist/**' --glob '!data/**'
```

Expected: no newly introduced executable shell path, unsafe flag use, installer, or hardcoded secret. Review matches manually; test fixtures and warning documentation may contain safe placeholder text.

- [ ] **Step 4: Perform two-axis review**

**Spec axis:** trace every acceptance-checklist item in spec §19 to code, test, UI, or documentation.
**Standards axis:** review module boundaries, duplicated probes, error sanitation, browser/runner trust, accessibility, dependency changes, and unrelated refactors.

- [ ] **Step 5: Perform final browser smoke test**

With the local authenticated runner:

- verify startup snapshot appears;
- verify manual refresh once;
- verify installed CLI/IDE evidence is sanitized;
- verify Pi/Kiro discovered models appear if their safe list probes succeed;
- verify catalog-only routes cannot be added;
- add a selectable model draft without starting a race;
- verify offline-mode copy/state using a separate runner invocation if practical;
- verify no browser console/network error and no unexpected outbound request.

Do not invoke a real model.

- [ ] **Step 6: Final evidence report**

Report changed files, implemented versus catalog-only harnesses, security controls, exact verification commands/results, skipped real-model test and reason, residual limitations, and any upstream capabilities left unverified. Do not claim a harness/model works unless observed through the appropriate non-paid discovery path.

- [ ] **Step 7: Integration decision**

Keep all changes uncommitted unless the user explicitly asks for a commit. If commit/push is later requested, first load and follow `secure-commit-guard` and `github-delivery`, stage specific files, and rerun `npm run check`.
