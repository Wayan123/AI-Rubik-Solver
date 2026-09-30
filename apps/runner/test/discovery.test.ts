import type { DiscoveryScanResult } from "@rubik-arena/adapters";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryService } from "../src/discovery.ts";

const empty = (warnings: DiscoveryScanResult["warnings"] = []): DiscoveryScanResult => ({
  environments: [{ id: "linux-local", kind: "linux", label: "Linux", available: true }],
  harnesses: [],
  models: [],
  warnings,
  offline: true,
});

describe("DiscoveryService", () => {
  it("returns scanning snapshots immediately without awaiting the scan", async () => {
    let release: (() => void) | undefined;
    const service = new DiscoveryService({
      offline: true,
      scan: () =>
        new Promise<DiscoveryScanResult>((resolve) => {
          release = () => resolve(empty());
        }),
    });
    const snapshot = service.ensureStarted();
    expect(snapshot).toMatchObject({ generation: 1, state: "scanning" });
    expect(service.getSnapshot().state).toBe("scanning");
    release?.();
    await service.whenIdle();
    expect(service.getSnapshot().state).toBe("ready");
  });

  it("starts one generation and shares it across concurrent callers", async () => {
    const scan = vi.fn(async () => empty());
    const service = new DiscoveryService({ scan, offline: true });
    const a = service.ensureStarted();
    const b = service.ensureStarted();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(a.generation).toBe(1);
    expect(b.generation).toBe(1);
    await service.whenIdle();
    expect(service.getSnapshot().state).toBe("ready");
  });

  it("returns prior catalog with scanning state during refresh", async () => {
    let release: (() => void) | undefined;
    let scans = 0;
    const service = new DiscoveryService({
      offline: true,
      cooldownMs: 0,
      scan: async () => {
        scans++;
        if (scans === 1)
          return {
            ...empty(),
            models: [
              {
                routeId: "r",
                harnessInstanceId: "h",
                modelId: "m",
                source: "live-cli",
                selectable: false,
                thinkingLevels: [],
              },
            ],
          };
        await new Promise<void>((resolve) => (release = resolve));
        return empty();
      },
    });
    service.ensureStarted();
    await service.whenIdle();
    const accepted = service.refresh();
    expect(accepted).toMatchObject({ accepted: true, snapshot: { state: "scanning" } });
    release?.();
    await service.whenIdle();
  });

  it("marks warnings partial without dropping successful results", async () => {
    const service = new DiscoveryService({
      offline: true,
      scan: async () => ({
        ...empty([{ code: "one", message: "failed" }]),
        harnesses: [
          {
            instanceId: "i",
            harnessId: "pi",
            displayName: "Pi",
            surface: "cli",
            environmentId: "linux-local",
            status: "ready",
            supportLevel: "verified-runnable",
            adapterId: "pi",
            modelDiscovery: "live",
            documentationUrl: "https://pi.dev",
          },
        ],
      }),
    });
    service.ensureStarted();
    await service.whenIdle();
    expect(service.getSnapshot()).toMatchObject({
      state: "partial",
      harnesses: [{ harnessId: "pi" }],
    });
  });

  it("retains the prior completed snapshot after a failed refresh", async () => {
    let fail = false;
    const service = new DiscoveryService({
      offline: true,
      cooldownMs: 0,
      scan: async () => {
        if (fail) throw new Error("Authorization: Bearer secret");
        return {
          ...empty(),
          models: [
            {
              routeId: "r",
              harnessInstanceId: "h",
              modelId: "kept",
              source: "live-cli",
              selectable: false,
              thinkingLevels: [],
            },
          ],
        };
      },
    });
    service.ensureStarted();
    await service.whenIdle();
    fail = true;
    service.refresh();
    await service.whenIdle();
    expect(service.getSnapshot().models[0]?.modelId).toBe("kept");
    expect(service.getSnapshot().warnings.at(-1)?.message).not.toContain("secret");
  });

  it("rejects refresh inside the 10000 ms cooldown", async () => {
    let now = 100;
    const service = new DiscoveryService({ offline: true, now: () => now, scan: async () => empty() });
    service.ensureStarted();
    await service.whenIdle();
    now = 5100;
    expect(service.refresh()).toEqual({ accepted: false, retryAfterMs: 5000 });
  });
});
