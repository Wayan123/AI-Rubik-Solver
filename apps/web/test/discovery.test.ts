import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError, classifyRunnerConnectionError, type DiscoverySnapshot } from "../src/api.ts";
import { HarnessCatalog } from "../src/components/HarnessCatalog.tsx";
import { contestantFromDiscoveredModel, filterDiscovery, isContestantStale } from "../src/discovery.ts";

const snapshot: DiscoverySnapshot = {
  generation: 1,
  state: "ready",
  offline: true,
  startedAt: "2026-09-30T00:00:00Z",
  completedAt: "2026-09-30T00:00:01Z",
  warnings: [],
  environments: [{ id: "wsl-local", kind: "wsl", label: "WSL", available: true }],
  harnesses: [
    {
      instanceId: "wsl-local:pi:cli",
      harnessId: "pi",
      displayName: "Pi coding agent",
      surface: "cli",
      environmentId: "wsl-local",
      status: "ready",
      supportLevel: "verified-runnable",
      adapterId: "pi",
      modelDiscovery: "live",
      documentationUrl: "https://pi.dev",
    },
    {
      instanceId: "wsl-local:codex:cli",
      harnessId: "codex",
      displayName: "OpenAI Codex",
      surface: "cli",
      environmentId: "wsl-local",
      status: "catalog-only",
      supportLevel: "catalog-only",
      modelDiscovery: "none",
      documentationUrl: "https://developers.openai.com/codex",
      update: {
        current: "1.0.0",
        latest: "1.1.0",
        releaseUrl: "https://github.com/openai/codex/releases/tag/v1.1.0",
      },
    },
  ],
  models: [
    {
      routeId: "wsl-local:pi:cli:openai-codex/gpt-sol-6.1",
      harnessInstanceId: "wsl-local:pi:cli",
      adapterId: "pi",
      modelId: "openai-codex/gpt-sol-6.1",
      provider: "openai-codex",
      source: "live-cli",
      selectable: true,
      thinkingLevels: ["high"],
    },
  ],
};

describe("catalog disclosure", () => {
  it("keeps model rows hidden by default while showing useful counts", () => {
    const html = renderToStaticMarkup(
      createElement(HarnessCatalog, {
        snapshot,
        busy: false,
        error: null,
        onRefresh: () => {},
        onAddModel: () => {},
        onBackToTop: () => {},
      }),
    );
    expect(html).toContain("2 harnesses · 1 model");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("View models");
    expect(html).not.toContain("openai-codex/gpt-sol-6.1");
    expect(html).not.toContain('class="model-list"');
  });
});

describe("runner connection errors", () => {
  it("classifies a stale bearer token as expired access rather than demo mode", () => {
    expect(classifyRunnerConnectionError(new ApiError("missing or invalid token", 401))).toEqual({
      kind: "auth",
      reason: "This dashboard access link has expired. Reopen the latest link printed by the local runner.",
    });
  });

  it("keeps network failures in demo mode", () => {
    expect(classifyRunnerConnectionError(new TypeError("Failed to fetch"))).toEqual({
      kind: "demo",
      reason: "Failed to fetch",
    });
  });
});

describe("discovery view", () => {
  it("searches across model, provider and harness", () => {
    expect(filterDiscovery(snapshot, "SOL-6.1", []).models).toHaveLength(1);
    expect(filterDiscovery(snapshot, "Pi coding", []).harnesses).toHaveLength(1);
    expect(filterDiscovery(snapshot, "missing", []).harnesses).toHaveLength(0);
  });

  it("filters statuses and updates", () => {
    expect(filterDiscovery(snapshot, "", ["catalog-only"]).harnesses.map((h) => h.harnessId)).toEqual([
      "codex",
    ]);
    expect(filterDiscovery(snapshot, "", ["updates"]).harnesses.map((h) => h.harnessId)).toEqual(["codex"]);
  });

  it("creates a contestant only from selectable routes", () => {
    expect(
      contestantFromDiscoveredModel(snapshot.models[0]!, snapshot.harnesses[0]!, "new-id"),
    ).toMatchObject({
      id: "new-id",
      adapter: "pi",
      model: "openai-codex/gpt-sol-6.1",
      mode: "interactive",
    });
    expect(() =>
      contestantFromDiscoveredModel(
        { ...snapshot.models[0]!, selectable: false },
        snapshot.harnesses[1]!,
        "x",
      ),
    ).toThrow("not selectable");
  });

  it("marks configured models stale without deleting them", () => {
    const config = {
      id: "x",
      label: "x",
      adapter: "pi",
      mode: "interactive" as const,
      maxTurns: 30,
      maxMovesPerTurn: 10,
      requestTimeoutMs: 600_000,
      runTimeoutMs: 1_800_000,
    };
    expect(isContestantStale({ ...config, model: "missing" }, snapshot)).toBe(true);
    expect(isContestantStale({ ...config, model: "openai-codex/gpt-sol-6.1" }, snapshot)).toBe(false);
  });
});
