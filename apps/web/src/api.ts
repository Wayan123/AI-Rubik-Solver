import type { ContestantConfig, RaceConfig, RaceEvent } from "@rubik-arena/bench-core";
import type { CubeState, Move, ScrambleSource } from "@rubik-arena/cube-engine";

const TOKEN_KEY = "rubik-arena-token";

/** Move `#token=…` from the URL into sessionStorage and strip it from the address bar. */
export function bootstrapToken(
  loc: Location = window.location,
  storage: Storage = sessionStorage,
): string | null {
  const match = /(?:^|[#&])token=([\w-]+)/.exec(loc.hash);
  if (match?.[1]) {
    storage.setItem(TOKEN_KEY, match[1]);
    history.replaceState(null, "", loc.pathname + loc.search);
  }
  return storage.getItem(TOKEN_KEY);
}

export interface AdapterStatus {
  id: string;
  name: string;
  kind: "cli" | "api" | "baseline";
  auth: "cli-login" | "api-key" | "none";
  description: string;
  thinkingLevels: string[];
  modelHint: string;
  browserCapable: boolean;
  available: boolean;
  version?: string;
}

export type DiscoveryState = "idle" | "scanning" | "ready" | "partial" | "failed";
export type HarnessStatus =
  | "ready"
  | "login-required"
  | "catalog-only"
  | "unavailable"
  | "discovery-failed"
  | "unsupported-version";

export interface RuntimeEnvironment {
  id: string;
  kind: "linux" | "macos" | "wsl" | "windows-host";
  label: string;
  available: boolean;
}

export interface DiscoveredHarness {
  instanceId: string;
  harnessId: string;
  displayName: string;
  surface: "cli" | "ide" | "extension";
  environmentId: string;
  status: HarnessStatus;
  supportLevel: "verified-runnable" | "catalog-only" | "blocked";
  version?: string;
  sanitizedLocation?: string;
  adapterId?: string;
  modelDiscovery: "live" | "local" | "none";
  documentationUrl: string;
  repositoryUrl?: string;
  update?: { current: string; latest: string; releaseUrl: string; publishedAt?: string };
  message?: string;
}

export interface DiscoveredModel {
  routeId: string;
  harnessInstanceId: string;
  adapterId?: string;
  modelId: string;
  provider?: string;
  displayName?: string;
  source: "live-cli" | "local-catalog" | "official-catalog";
  selectable: boolean;
  thinkingLevels: string[];
}

export interface DiscoverySnapshot {
  generation: number;
  state: DiscoveryState;
  startedAt?: string;
  completedAt?: string;
  environments: RuntimeEnvironment[];
  harnesses: DiscoveredHarness[];
  models: DiscoveredModel[];
  warnings: Array<{ code: string; harnessInstanceId?: string; message: string }>;
  offline: boolean;
}

export interface RaceSummary {
  id: string;
  createdAt: string;
  status: string;
  scrambleDepth: number;
  scrambleSource?: string;
  startDistance?: { value: number; exact: boolean };
  contestants: Array<{ label: string; status: string; wallMs: number; progress: number; solved: boolean }>;
}

export interface CreateRace {
  scramble: {
    source: ScrambleSource;
    seed?: number;
    depth?: number;
    moves?: Move[];
    state?: string;
  };
  concurrency: number;
  contestants: ContestantConfig[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type RunnerConnectionFailure = { kind: "auth"; reason: string } | { kind: "demo"; reason: string };

export function classifyRunnerConnectionError(error: unknown): RunnerConnectionFailure {
  if (error instanceof ApiError && error.status === 401) {
    return {
      kind: "auth",
      reason: "This dashboard access link has expired. Reopen the latest link printed by the local runner.",
    };
  }
  return { kind: "demo", reason: error instanceof Error ? error.message : String(error) };
}

export class RunnerApi {
  constructor(
    private readonly token: string | null,
    private readonly base = "",
  ) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as {
          error?: string;
          issues?: Array<{ message: string; path: unknown[] }>;
        };
        msg = body.error ?? msg;
        if (body.issues?.length)
          msg += `: ${body.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
      } catch {}
      throw new ApiError(msg, res.status);
    }
    return (await res.json()) as T;
  }

  health = () => this.req<{ ok: boolean; version: string }>("/api/health");
  adapters = () => this.req<AdapterStatus[]>("/api/adapters");
  discovery = () => this.req<DiscoverySnapshot>("/api/discovery");
  discoveryStatus = () =>
    this.req<
      Pick<DiscoverySnapshot, "generation" | "state" | "startedAt" | "completedAt" | "offline"> & {
        warningCount: number;
      }
    >("/api/discovery/status");
  refreshDiscovery = () => this.req<DiscoverySnapshot>("/api/discovery/refresh", { method: "POST" });
  models = (id: string) => this.req<{ models: string[] }>(`/api/adapters/${encodeURIComponent(id)}/models`);
  presets = () => this.req<{ contestants: ContestantConfig[] }>("/api/presets");
  races = () => this.req<{ races: RaceSummary[] }>("/api/races");
  race = (id: string) =>
    this.req<{ race: RaceConfig; initialState: CubeState; status: string; events: RaceEvent[] }>(
      `/api/races/${encodeURIComponent(id)}`,
    );
  createRace = (body: CreateRace) =>
    this.req<{ id: string; race: RaceConfig; initialState: CubeState }>("/api/races", {
      method: "POST",
      body: JSON.stringify(body),
    });
  cancel = (id: string) =>
    this.req<{ ok: boolean }>(`/api/races/${encodeURIComponent(id)}/cancel`, { method: "POST" });

  /** SSE via fetch (EventSource cannot send the Authorization header). */
  async streamEvents(id: string, onEvent: (e: RaceEvent) => void, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}/api/races/${encodeURIComponent(id)}/events`, {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      signal,
    });
    if (!res.ok || !res.body) throw new ApiError(`event stream failed (${res.status})`, res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf("\n\n");
      while (idx !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)) as RaceEvent);
        }
        idx = buf.indexOf("\n\n");
      }
    }
  }
}
