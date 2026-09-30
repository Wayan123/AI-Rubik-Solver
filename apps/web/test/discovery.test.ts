import { describe, expect, it } from "vitest";
import type { DiscoverySnapshot } from "../src/api.ts";
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
