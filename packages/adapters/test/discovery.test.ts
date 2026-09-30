import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boundedText,
  checkHarnessUpdate,
  classifyEnvironment,
  clearReleaseCache,
  HARNESS_DEFINITIONS,
  normalizeComparableVersion,
  resolvePathExecutables,
  resolveWindowsHomeRoot,
  safeReadJsonManifest,
  sanitizeDiscoveryText,
  scanDiscovery,
  windowsPathToWsl,
} from "../src/index.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("release metadata", () => {
  afterEach(() => clearReleaseCache());

  it("streams with a byte cap and caches one official lookup", async () => {
    const definition = {
      ...HARNESS_DEFINITIONS.find((item) => item.id === "codex")!,
      releaseSource: {
        host: "api.github.com" as const,
        owner: "openai",
        repository: "codex",
        includePrereleases: false as const,
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v1.1.0",
          html_url: "https://github.com/openai/codex/releases/tag/v1.1.0",
          prerelease: false,
          draft: false,
        }),
      ),
    );
    await Promise.all([
      checkHarnessUpdate(definition, "1.0.0", { fetch: fetcher, offline: false }),
      checkHarnessUpdate(definition, "1.0.0", { fetch: fetcher, offline: false }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    clearReleaseCache();
    fetcher.mockResolvedValueOnce(
      new Response("x".repeat(256 * 1024 + 1), {
        headers: { "content-length": String(256 * 1024 + 1) },
      }),
    );
    await expect(checkHarnessUpdate(definition, "1.0.0", { fetch: fetcher, offline: false })).rejects.toThrow(
      "too large",
    );
  });

  it("normalizes comparable versions conservatively", () => {
    expect(normalizeComparableVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(normalizeComparableVersion("codex-cli 0.159.1")).toEqual([0, 159, 1]);
    expect(normalizeComparableVersion("nightly-latest")).toBeNull();
    expect(normalizeComparableVersion("1.2.3-beta.1")).toBeNull();
  });

  it("makes no request offline and ignores prereleases", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const definition = {
      ...HARNESS_DEFINITIONS.find((item) => item.id === "codex")!,
      releaseSource: {
        host: "api.github.com" as const,
        owner: "openai",
        repository: "codex",
        includePrereleases: false as const,
      },
    };
    expect(await checkHarnessUpdate(definition, "1.0.0", { fetch: fetcher, offline: true })).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();

    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v1.1.0-beta.1",
          html_url: "https://github.com/openai/codex/releases/tag/v1.1.0-beta.1",
          prerelease: true,
          draft: false,
        }),
      ),
    );
    expect(await checkHarnessUpdate(definition, "1.0.0", { fetch: fetcher, offline: false })).toBeUndefined();
  });

  it("reports a newer official stable release", async () => {
    const definition = {
      ...HARNESS_DEFINITIONS.find((item) => item.id === "codex")!,
      releaseSource: {
        host: "api.github.com" as const,
        owner: "openai",
        repository: "codex",
        includePrereleases: false as const,
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v1.1.0",
          html_url: "https://github.com/openai/codex/releases/tag/v1.1.0",
          prerelease: false,
          draft: false,
          published_at: "2026-09-30T00:00:00Z",
        }),
      ),
    );
    expect(
      await checkHarnessUpdate(definition, "codex-cli 1.0.0", { fetch: fetcher, offline: false }),
    ).toEqual({
      current: "1.0.0",
      latest: "1.1.0",
      releaseUrl: "https://github.com/openai/codex/releases/tag/v1.1.0",
      publishedAt: "2026-09-30T00:00:00Z",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/openai/codex/releases/latest");
  });
});

describe("discovery public output", () => {
  it("redacts POSIX and Windows home roots from public discovery messages", () => {
    expect(
      sanitizeDiscoveryText("failed in /home/alice/.pi and C:\\Users\\Alice\\.codex", [
        "/home/alice",
        "C:\\Users\\Alice",
      ]),
    ).toBe("failed in <HOME>/.pi and <HOME>/.codex");
  });

  it("redacts bearer tokens, key-like assignments, URL queries, ANSI and control characters", () => {
    const input = "\u001b[31mAuthorization: Bearer abc.def api_key=sk-secret https://x.test/a?t=secret\u0000";
    const out = sanitizeDiscoveryText(input);
    expect(out).not.toContain("abc.def");
    expect(out).not.toContain("sk-secret");
    expect(out).not.toContain("secret");
    expect(
      [...out].every((character) => {
        const code = character.codePointAt(0)!;
        return code >= 32 && code !== 127;
      }),
    ).toBe(true);
    expect(out).toContain("<REDACTED>");
  });

  it("bounds public output by UTF-8 byte length", () => {
    expect(Buffer.byteLength(boundedText("é".repeat(100), 32))).toBeLessThanOrEqual(32);
  });
});

describe("discovery environments and registry", () => {
  it.each([
    ["linux", "6.8.0", "linux"],
    ["darwin", "24.0.0", "macos"],
    ["linux", "6.8.0-microsoft-standard-WSL2", "wsl"],
  ] as const)("classifies %s %s as %s", (platform, release, expected) => {
    expect(classifyEnvironment(platform, release)).toBe(expected);
  });

  it("resolves executable files in PATH order and deduplicates real paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "ra-discovery-"));
    temporary.push(root);
    const a = join(root, "a");
    const b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const binary = join(a, "pi");
    await writeFile(binary, "#!/bin/sh\n");
    await chmod(binary, 0o755);
    await symlink(binary, join(b, "pi"));
    expect(await resolvePathExecutables(["pi"], `${a}:${b}`)).toEqual([
      expect.objectContaining({ name: "pi", path: binary, shadowed: false }),
    ]);
  });

  it("ignores missing, non-executable, directory, and broken-link candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "ra-discovery-"));
    temporary.push(root);
    await writeFile(join(root, "pi"), "not executable");
    await mkdir(join(root, "codex"));
    await symlink(join(root, "missing"), join(root, "kiro-cli"));
    expect(await resolvePathExecutables(["pi", "codex", "kiro-cli", "missing"], root)).toEqual([]);
  });

  it("converts one absolute Windows profile path to its WSL mount", () => {
    expect(windowsPathToWsl("C:\\Users\\Alice")).toBe("/mnt/c/Users/Alice");
    expect(windowsPathToWsl("relative\\Users\\Alice")).toBeNull();
  });

  it("rejects Windows roots outside one canonical user profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "ra-windows-root-"));
    temporary.push(root);
    expect(await resolveWindowsHomeRoot("/mnt/c/Users")).toBeNull();
    expect(await resolveWindowsHomeRoot("/mnt/c/Users/Alice/../Bob")).toBeNull();
    expect(await resolveWindowsHomeRoot(root)).toBeNull();
  });

  it("reads only bounded regular manifests contained by the approved root", async () => {
    const root = await mkdtemp(join(tmpdir(), "ra-manifest-"));
    temporary.push(root);
    const folder = join(root, "continue.continue-1");
    const good = join(folder, "package.json");
    await mkdir(folder);
    await writeFile(good, JSON.stringify({ publisher: "Continue", name: "continue", version: "1.0.0" }));
    expect(
      await safeReadJsonManifest(good, root, { expectedId: "Continue.continue", maxBytes: 1024 }),
    ).toMatchObject({ version: "1.0.0" });

    const outside = await mkdtemp(join(tmpdir(), "ra-outside-"));
    temporary.push(outside);
    await writeFile(
      join(outside, "package.json"),
      JSON.stringify({ publisher: "Continue", name: "continue" }),
    );
    await symlink(join(outside, "package.json"), join(root, "escape.json"));
    await expect(
      safeReadJsonManifest(join(root, "escape.json"), root, {
        expectedId: "Continue.continue",
        maxBytes: 1024,
      }),
    ).rejects.toThrow("symlink");

    await writeFile(join(root, "large.json"), "x".repeat(1025));
    await expect(
      safeReadJsonManifest(join(root, "large.json"), root, { expectedId: "x.y", maxBytes: 1024 }),
    ).rejects.toThrow("too large");
    await expect(
      safeReadJsonManifest(good, root, { expectedId: "wrong.id", maxBytes: 1024 }),
    ).rejects.toThrow("identity");
  });

  it("honors documented binary overrides without changing capability", async () => {
    const probe = vi.fn(async () => ({ exitCode: 0, stdout: "kiro-cli 2.0.0", stderr: "" }));
    const snapshot = await scanDiscovery({
      platform: "linux",
      release: "6.8.0",
      pathValue: "",
      env: { RUBIK_KIRO_BIN: "/custom/kiro-cli" },
      signal: new AbortController().signal,
      offline: true,
      probe,
    });
    expect(snapshot.harnesses).toContainEqual(
      expect.objectContaining({ harnessId: "kiro-cli", supportLevel: "verified-runnable" }),
    );
    expect(probe).toHaveBeenCalledWith("/custom/kiro-cli", ["--version"]);
  });

  it("keeps capability policy source-controlled", () => {
    const definition = (id: string) => HARNESS_DEFINITIONS.find((item) => item.id === id);
    expect(definition("pi")).toMatchObject({ supportLevel: "verified-runnable", adapterId: "pi" });
    expect(definition("kiro-cli")).toMatchObject({
      supportLevel: "verified-runnable",
      adapterId: "kiro-cli",
    });
    expect(definition("hermes")).toMatchObject({
      supportLevel: "verified-runnable",
      adapterId: "hermes",
    });
    for (const id of [
      "codex",
      "claude-code",
      "gemini-cli",
      "opencode",
      "aider",
      "continue",
      "cline",
      "roo-code",
    ]) {
      expect(definition(id)?.supportLevel).toBe("catalog-only");
    }
    expect(HARNESS_DEFINITIONS.every((item) => item.documentationUrl.startsWith("https://"))).toBe(true);
  });

  it("discovers Pi models but never invents a direct Codex model-list probe", async () => {
    const root = await mkdtemp(join(tmpdir(), "ra-discovery-"));
    temporary.push(root);
    for (const name of ["pi", "codex"]) {
      const path = join(root, name);
      await writeFile(path, "#!/bin/sh\n");
      await chmod(path, 0o755);
    }
    const probe = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args.includes("--version")) return { exitCode: 0, stdout: "tool 1.0.0\n", stderr: "" };
      if (args.includes("--list-models")) {
        return {
          exitCode: 0,
          stdout: "provider model context\nopenai-codex gpt-sol-6.1 200k\nopenai-codex gpt-sol-6.1 200k\n",
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected" };
    });
    const snapshot = await scanDiscovery({
      platform: "linux",
      release: "6.8.0",
      pathValue: root,
      env: {},
      signal: new AbortController().signal,
      offline: true,
      probe,
    });
    expect(snapshot.models).toContainEqual(
      expect.objectContaining({
        modelId: "openai-codex/gpt-sol-6.1",
        adapterId: "pi",
        selectable: true,
        source: "live-cli",
      }),
    );
    expect(snapshot.models.filter((m) => m.modelId === "openai-codex/gpt-sol-6.1")).toHaveLength(1);
    expect(snapshot.models.every((m) => m.routeId.includes(m.harnessInstanceId))).toBe(true);
    expect(snapshot.harnesses).toContainEqual(
      expect.objectContaining({ harnessId: "codex", supportLevel: "catalog-only" }),
    );
    expect(
      probe.mock.calls.some(([command, args]) => command.includes("codex") && args.includes("--list-models")),
    ).toBe(false);
  });
});
