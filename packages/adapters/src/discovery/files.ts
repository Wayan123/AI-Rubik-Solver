import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

interface ManifestOptions {
  expectedId: string;
  maxBytes: number;
}

function contained(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.includes(":") && !rel.startsWith("/"));
}

export async function safeReadJsonManifest(
  path: string,
  approvedRoot: string,
  options: ManifestOptions,
): Promise<Record<string, unknown>> {
  if (!contained(path, approvedRoot)) throw new Error("manifest is outside approved root");
  const linkInfo = await lstat(path);
  if (linkInfo.isSymbolicLink()) throw new Error("manifest symlink is not allowed");
  if (!linkInfo.isFile()) throw new Error("manifest must be a regular file");
  const resolvedRoot = await realpath(approvedRoot);
  const resolvedPath = await realpath(path);
  if (!contained(resolvedPath, resolvedRoot)) throw new Error("manifest escapes approved root");
  const info = await stat(resolvedPath);
  if (info.size > options.maxBytes) throw new Error(`manifest is too large (${info.size} bytes)`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
  } catch {
    throw new Error("manifest is malformed JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("manifest must be an object");
  const object = parsed as Record<string, unknown>;
  const identity = `${String(object.publisher ?? "")}.${String(object.name ?? "")}`;
  if (identity.toLowerCase() !== options.expectedId.toLowerCase()) {
    throw new Error(`manifest identity does not match ${options.expectedId}`);
  }
  return object;
}
