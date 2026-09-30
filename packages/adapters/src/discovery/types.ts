export type DiscoveryState = "idle" | "scanning" | "ready" | "partial" | "failed";
export type HarnessSurface = "cli" | "ide" | "extension";
export type EnvironmentKind = "linux" | "macos" | "wsl" | "windows-host";
export type SupportLevel = "verified-runnable" | "catalog-only" | "blocked";
export type HarnessStatus =
  | "ready"
  | "login-required"
  | "catalog-only"
  | "unavailable"
  | "discovery-failed"
  | "unsupported-version";
export type ModelSource = "live-cli" | "local-catalog" | "official-catalog";

export interface RuntimeEnvironment {
  id: string;
  kind: EnvironmentKind;
  label: string;
  available: boolean;
}

export interface HarnessUpdate {
  current: string;
  latest: string;
  releaseUrl: string;
  publishedAt?: string;
}

export interface DiscoveredHarness {
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

export interface DiscoveredModel {
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

export interface DiscoveryWarning {
  code: string;
  harnessInstanceId?: string;
  message: string;
}

export interface DiscoverySnapshot {
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

export interface HarnessDetection {
  harnesses: DiscoveredHarness[];
  models?: DiscoveredModel[];
  warnings?: DiscoveryWarning[];
}

export interface DiscoveryProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface DiscoveryContext {
  platform: NodeJS.Platform;
  release: string;
  versionText?: string;
  pathValue: string;
  env: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
  offline: boolean;
  probe?: (command: string, args: readonly string[]) => Promise<DiscoveryProbeResult>;
  fetch?: typeof fetch;
}

export interface HarnessDetector {
  detect(context: DiscoveryContext): Promise<HarnessDetection[]>;
}

export interface HarnessSurfaceDefinition {
  surface: HarnessSurface;
  binaryNames?: readonly string[];
  extensionIds?: readonly string[];
}

export interface HarnessDefinition {
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
