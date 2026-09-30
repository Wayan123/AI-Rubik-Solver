import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, join, relative, resolve } from "node:path";
import type { EnvironmentKind } from "./types.ts";

export interface ResolvedExecutable {
  name: string;
  path: string;
  realPath: string;
  shadowed: boolean;
}

export function classifyEnvironment(
  platform: NodeJS.Platform,
  release: string,
  versionText = "",
): EnvironmentKind {
  if (platform === "darwin") return "macos";
  if (platform === "linux" && /microsoft|wsl/i.test(`${release} ${versionText}`)) return "wsl";
  return "linux";
}

export function windowsPathToWsl(value: string): string | null {
  const match = /^([A-Za-z]):\\(.+)$/.exec(value.trim());
  if (!match) return null;
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}`;
}

export async function resolveWindowsHomeRoot(value: string): Promise<string | null> {
  if (value.replaceAll("\\", "/").split("/").includes("..")) return null;
  const normalized = resolve(value);
  if (!/^\/mnt\/[a-z]\/Users\/[^/]+$/i.test(normalized)) return null;
  try {
    const canonical = await realpath(normalized);
    if (!/^\/mnt\/[a-z]\/Users\/[^/]+$/i.test(canonical)) return null;
    const usersRoot = resolve(canonical, "..");
    const rel = relative(usersRoot, canonical);
    return rel && !rel.startsWith("..") && !rel.includes("/") ? canonical : null;
  } catch {
    return null;
  }
}

export async function resolvePathExecutables(
  names: readonly string[],
  pathValue: string,
): Promise<ResolvedExecutable[]> {
  const found: ResolvedExecutable[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    for (const directory of pathValue.split(delimiter).filter(Boolean)) {
      const candidate = join(directory, name);
      try {
        const info = await stat(candidate);
        if (!info.isFile()) continue;
        await access(candidate, constants.X_OK);
        const resolved = await realpath(candidate);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        found.push({
          name,
          path: candidate,
          realPath: resolved,
          shadowed: found.some((x) => x.name === name),
        });
      } catch {}
    }
  }
  return found;
}
