import type { HarnessDefinition, HarnessUpdate } from "./types.ts";

export type ComparableVersion = [number, number, number];
const RELEASE_LIMIT_BYTES = 256 * 1024;
const releaseCache = new Map<string, Promise<ReleaseMetadata | undefined>>();

interface ReleaseMetadata {
  version: ComparableVersion;
  releaseUrl: string;
  publishedAt?: string;
}

export function clearReleaseCache(): void {
  releaseCache.clear();
}

export function normalizeComparableVersion(value: string): ComparableVersion | null {
  if (/\d+\.\d+\.\d+-[0-9A-Za-z]/.test(value)) return null;
  const match = /(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: ComparableVersion, b: ComparableVersion): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

interface Options {
  fetch: typeof fetch;
  offline: boolean;
  signal?: AbortSignal;
}

async function boundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RELEASE_LIMIT_BYTES) {
    throw new Error("release metadata is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RELEASE_LIMIT_BYTES) throw new Error("release metadata is too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

async function fetchMetadata(
  host: "api.github.com",
  owner: string,
  repository: string,
  options: Options,
): Promise<ReleaseMetadata | undefined> {
  const url = `https://${host}/repos/${owner}/${repository}/releases/latest`;
  const response = await options.fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: options.signal,
    headers: { accept: "application/vnd.github+json", "user-agent": "rubik-arena-discovery" },
  });
  if (!response.ok || response.status >= 300) return undefined;
  const data = JSON.parse(await boundedBody(response)) as Record<string, unknown>;
  if (data.draft === true || data.prerelease === true) return undefined;
  const version = normalizeComparableVersion(typeof data.tag_name === "string" ? data.tag_name : "");
  if (!version) return undefined;
  const releaseUrl = typeof data.html_url === "string" ? data.html_url : "";
  const expectedPrefix = `https://github.com/${owner}/${repository}/releases/`;
  if (!releaseUrl.startsWith(expectedPrefix)) throw new Error("release URL is not allowlisted");
  return {
    version,
    releaseUrl,
    publishedAt: typeof data.published_at === "string" ? data.published_at : undefined,
  };
}

export async function checkHarnessUpdate(
  definition: HarnessDefinition,
  currentVersion: string,
  options: Options,
): Promise<HarnessUpdate | undefined> {
  if (options.offline || !definition.releaseSource) return undefined;
  const current = normalizeComparableVersion(currentVersion);
  if (!current) return undefined;
  const { host, owner, repository } = definition.releaseSource;
  if (
    host !== "api.github.com" ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new Error("release source is not allowlisted");
  }
  const key = `${host}/${owner}/${repository}`;
  let pending = releaseCache.get(key);
  if (!pending) {
    pending = fetchMetadata(host, owner, repository, options);
    releaseCache.set(key, pending);
    pending.catch(() => releaseCache.delete(key));
  }
  const metadata = await pending;
  if (!metadata || compare(metadata.version, current) <= 0) return undefined;
  return {
    current: current.join("."),
    latest: metadata.version.join("."),
    releaseUrl: metadata.releaseUrl,
    publishedAt: metadata.publishedAt,
  };
}
