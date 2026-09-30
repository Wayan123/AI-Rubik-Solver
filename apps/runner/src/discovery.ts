import type { DiscoveryScanResult, DiscoverySnapshot } from "@rubik-arena/adapters";
import { sanitizeDiscoveryText } from "@rubik-arena/adapters";

export const DISCOVERY_COOLDOWN_MS = 10_000;

interface Options {
  scan: () => Promise<DiscoveryScanResult>;
  now?: () => number;
  cooldownMs?: number;
  offline: boolean;
}

const initial = (offline: boolean): DiscoverySnapshot => ({
  generation: 0,
  state: "idle",
  environments: [],
  harnesses: [],
  models: [],
  warnings: [],
  offline,
});

export class DiscoveryService {
  private snapshot: DiscoverySnapshot;
  private inFlight?: Promise<DiscoverySnapshot>;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly cooldownMs: number;

  constructor(private readonly options: Options) {
    this.snapshot = initial(options.offline);
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? DISCOVERY_COOLDOWN_MS;
  }

  getSnapshot(): DiscoverySnapshot {
    return structuredClone(this.snapshot);
  }

  ensureStarted(): DiscoverySnapshot {
    if (!this.inFlight && this.snapshot.generation === 0) this.startScan();
    return this.getSnapshot();
  }

  whenIdle(): Promise<DiscoverySnapshot> {
    return this.inFlight ?? Promise.resolve(this.getSnapshot());
  }

  refresh(): { accepted: true; snapshot: DiscoverySnapshot } | { accepted: false; retryAfterMs: number } {
    if (this.inFlight) return { accepted: true, snapshot: this.getSnapshot() };
    const elapsed = this.now() - this.lastStartedAt;
    if (elapsed < this.cooldownMs) {
      return { accepted: false, retryAfterMs: Math.ceil(this.cooldownMs - elapsed) };
    }
    this.startScan();
    return { accepted: true, snapshot: this.getSnapshot() };
  }

  private startScan(): Promise<DiscoverySnapshot> {
    const previous = this.snapshot;
    const generation = previous.generation + 1;
    const started = this.now();
    this.lastStartedAt = started;
    this.snapshot = {
      ...previous,
      generation,
      state: "scanning",
      startedAt: new Date(started).toISOString(),
      completedAt: previous.completedAt,
    };
    this.inFlight = this.options
      .scan()
      .then((result) => {
        this.snapshot = {
          ...result,
          generation,
          state: result.warnings.length ? "partial" : "ready",
          startedAt: new Date(started).toISOString(),
          completedAt: new Date(this.now()).toISOString(),
        };
        return this.getSnapshot();
      })
      .catch((error) => {
        const warning = {
          code: "scan-failed",
          message: sanitizeDiscoveryText(error instanceof Error ? error.message : String(error)),
        };
        this.snapshot = previous.generation
          ? {
              ...previous,
              generation,
              state: "partial",
              startedAt: new Date(started).toISOString(),
              completedAt: previous.completedAt,
              warnings: [...previous.warnings, warning],
            }
          : {
              ...initial(this.options.offline),
              generation,
              state: "failed",
              startedAt: new Date(started).toISOString(),
              completedAt: new Date(this.now()).toISOString(),
              warnings: [warning],
            };
        return this.getSnapshot();
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}
