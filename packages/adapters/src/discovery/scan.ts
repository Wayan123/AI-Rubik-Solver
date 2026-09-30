import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { adapterModelProbe } from "../registry.ts";
import { spawnCli } from "../spawn.ts";
import {
  classifyEnvironment,
  resolvePathExecutables,
  resolveWindowsHomeRoot,
  windowsPathToWsl,
} from "./environment.ts";
import { safeReadJsonManifest } from "./files.ts";
import { HARNESS_DEFINITIONS } from "./registry.ts";
import { checkHarnessUpdate } from "./releases.ts";
import { sanitizeDiscoveryText } from "./sanitize.ts";
import type {
  DiscoveredHarness,
  DiscoveredModel,
  DiscoveryContext,
  DiscoverySnapshot,
  DiscoveryWarning,
} from "./types.ts";

export type DiscoveryScanResult = Omit<
  DiscoverySnapshot,
  "generation" | "state" | "startedAt" | "completedAt"
>;

const THINKING: Record<string, string[]> = {
  pi: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  "kiro-cli": ["low", "medium", "high", "xhigh", "max"],
};

const OVERRIDE_ENV: Record<string, string> = {
  pi: "RUBIK_PI_BIN",
  "kiro-cli": "RUBIK_KIRO_BIN",
  hermes: "RUBIK_HERMES_BIN",
};

export async function scanDiscovery(context: DiscoveryContext): Promise<DiscoveryScanResult> {
  const kind = classifyEnvironment(context.platform, context.release, context.versionText);
  const environmentId = kind === "wsl" ? "wsl-local" : `${kind}-local`;
  const probe =
    context.probe ??
    (async (command: string, args: readonly string[]) => {
      const result = await spawnCli({
        command,
        args,
        signal: context.signal,
        timeoutMs: 15_000,
        stdoutLimitBytes: 1024 * 1024,
      });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    });
  const environments = [{ id: environmentId, kind, label: kind === "wsl" ? "WSL" : kind, available: true }];
  const extensionRoots: Array<{ root: string; environmentId: string }> = [];
  const home = context.env.HOME;
  if (home) {
    extensionRoots.push(
      { root: join(home, ".vscode", "extensions"), environmentId },
      { root: join(home, ".vscode-server", "extensions"), environmentId },
      { root: join(home, ".cursor", "extensions"), environmentId },
      { root: join(home, ".windsurf", "extensions"), environmentId },
    );
  }
  let windowsHome = context.env.RUBIK_WINDOWS_HOME;
  if (kind === "wsl" && !windowsHome) {
    try {
      const result = await probe("/mnt/c/WINDOWS/system32/cmd.exe", ["/d", "/c", "echo", "%USERPROFILE%"]);
      if (result.exitCode === 0) windowsHome = windowsPathToWsl(result.stdout.trim()) ?? undefined;
    } catch {}
  }
  windowsHome = windowsHome ? ((await resolveWindowsHomeRoot(windowsHome)) ?? undefined) : undefined;
  if (kind === "wsl" && windowsHome) {
    const windowsEnvironmentId = "windows-host-active";
    environments.push({
      id: windowsEnvironmentId,
      kind: "windows-host",
      label: "Windows host",
      available: true,
    });
    for (const ide of [".vscode", ".cursor", ".windsurf"]) {
      extensionRoots.push({
        root: join(windowsHome, ide, "extensions"),
        environmentId: windowsEnvironmentId,
      });
    }
  }
  const harnesses: DiscoveredHarness[] = [];
  const models: DiscoveredModel[] = [];
  const warnings: DiscoveryWarning[] = [];

  for (const definition of HARNESS_DEFINITIONS) {
    const binaryNames = definition.surfaces.flatMap((surface) => surface.binaryNames ?? []);
    if (!binaryNames.length) continue;
    const override =
      context.env[
        OVERRIDE_ENV[definition.id] ?? `RUBIK_${definition.id.toUpperCase().replaceAll("-", "_")}_BIN`
      ];
    const executables = override
      ? [{ name: binaryNames[0]!, path: override, realPath: override, shadowed: false }]
      : await resolvePathExecutables(binaryNames, context.pathValue);
    const executable = executables[0];
    if (!executable) continue;
    const instanceId = `${environmentId}:${definition.id}:cli`;
    let version: string | undefined;
    try {
      const result = await probe(executable.path, ["--version"]);
      if (result.exitCode !== 0) throw new Error(result.stderr || `version exited ${result.exitCode}`);
      version = sanitizeDiscoveryText((result.stdout || result.stderr).trim(), [context.env.HOME ?? ""]);
    } catch (error) {
      warnings.push({
        code: "version-probe-failed",
        harnessInstanceId: instanceId,
        message: sanitizeDiscoveryText(error instanceof Error ? error.message : String(error), [
          context.env.HOME ?? "",
        ]),
      });
    }
    const modelProbe = adapterModelProbe(definition.adapterId ?? definition.id);
    const modelDiscovery = modelProbe ? "live" : "none";
    const versionReady = Boolean(version);
    const harness: DiscoveredHarness = {
      instanceId,
      harnessId: definition.id,
      displayName: definition.displayName,
      surface: "cli",
      environmentId,
      status:
        definition.supportLevel === "verified-runnable"
          ? versionReady
            ? "ready"
            : "discovery-failed"
          : "catalog-only",
      supportLevel: definition.supportLevel,
      version: version || undefined,
      sanitizedLocation: sanitizeDiscoveryText(executable.path, [context.env.HOME ?? ""]),
      adapterId: definition.adapterId,
      modelDiscovery,
      documentationUrl: definition.documentationUrl,
      repositoryUrl: definition.repositoryUrl,
    };
    harnesses.push(harness);

    if (!context.offline && version && definition.releaseSource) {
      try {
        harness.update = await checkHarnessUpdate(definition, version, {
          fetch: context.fetch ?? fetch,
          offline: false,
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]),
        });
      } catch (error) {
        warnings.push({
          code: "release-check-failed",
          harnessInstanceId: instanceId,
          message: sanitizeDiscoveryText(error instanceof Error ? error.message : String(error), [
            context.env.HOME ?? "",
          ]),
        });
      }
    }

    if (modelDiscovery !== "live") continue;
    try {
      const result = await probe(executable.path, modelProbe!.args);
      if (result.exitCode !== 0) throw new Error(result.stderr || `model list exited ${result.exitCode}`);
      const listed = modelProbe!.parse(result.stdout);
      for (const modelId of new Set(listed)) {
        const provider = modelId.includes("/") ? modelId.split("/")[0] : undefined;
        models.push({
          routeId: `${instanceId}:${modelId}`,
          harnessInstanceId: instanceId,
          adapterId: definition.adapterId,
          modelId,
          provider,
          source: "live-cli",
          selectable:
            definition.supportLevel === "verified-runnable" && Boolean(definition.adapterId) && versionReady,
          thinkingLevels: THINKING[definition.id] ?? [],
        });
      }
    } catch (error) {
      harness.status = /not logged|log in|login|required|unauthori[sz]ed|forbidden|\b401\b|\b403\b/i.test(
        error instanceof Error ? error.message : String(error),
      )
        ? "login-required"
        : "discovery-failed";
      warnings.push({
        code: "model-probe-failed",
        harnessInstanceId: instanceId,
        message: sanitizeDiscoveryText(error instanceof Error ? error.message : String(error), [
          context.env.HOME ?? "",
        ]),
      });
    }
  }

  for (const definition of HARNESS_DEFINITIONS) {
    for (const surface of definition.surfaces) {
      if (surface.surface !== "extension" || !surface.extensionIds?.length) continue;
      for (const { root, environmentId: extensionEnvironmentId } of extensionRoots) {
        let entries: string[];
        try {
          entries = await readdir(root);
        } catch {
          continue;
        }
        for (const extensionId of surface.extensionIds) {
          for (const entry of entries.filter((name) =>
            name.toLowerCase().startsWith(`${extensionId.toLowerCase()}-`),
          )) {
            try {
              const manifest = await safeReadJsonManifest(join(root, entry, "package.json"), root, {
                expectedId: extensionId,
                maxBytes: 256 * 1024,
              });
              const instanceId = `${extensionEnvironmentId}:${definition.id}:extension:${extensionId.toLowerCase()}`;
              if (harnesses.some((item) => item.instanceId === instanceId)) continue;
              harnesses.push({
                instanceId,
                harnessId: definition.id,
                displayName: definition.displayName,
                surface: "extension",
                environmentId: extensionEnvironmentId,
                status: "catalog-only",
                supportLevel: "catalog-only",
                version: typeof manifest.version === "string" ? manifest.version : undefined,
                modelDiscovery: "none",
                documentationUrl: definition.documentationUrl,
                repositoryUrl: definition.repositoryUrl,
              });
            } catch (error) {
              warnings.push({
                code: "extension-manifest-rejected",
                message: sanitizeDiscoveryText(error instanceof Error ? error.message : String(error), [
                  home ?? "",
                  windowsHome ?? "",
                ]),
              });
            }
          }
        }
      }
    }
  }

  if (kind === "wsl" && windowsHome) {
    const definition = HARNESS_DEFINITIONS.find((item) => item.id === "kiro-cli")!;
    const programs = join(windowsHome, "AppData", "Local", "Programs");
    const manifestPath = join(programs, "Kiro", "resources", "app", "package.json");
    try {
      const manifest = await safeReadJsonManifest(manifestPath, programs, {
        expectedId: ".Kiro",
        maxBytes: 256 * 1024,
      });
      harnesses.push({
        instanceId: "windows-host-active:kiro-cli:ide",
        harnessId: "kiro-cli",
        displayName: "Kiro IDE",
        surface: "ide",
        environmentId: "windows-host-active",
        status: "catalog-only",
        supportLevel: "catalog-only",
        version: typeof manifest.version === "string" ? manifest.version : undefined,
        modelDiscovery: "none",
        documentationUrl: definition.documentationUrl,
        repositoryUrl: definition.repositoryUrl,
      });
    } catch {}
  }

  for (const definition of HARNESS_DEFINITIONS) {
    if (harnesses.some((item) => item.harnessId === definition.id)) continue;
    const surface = definition.surfaces[0]?.surface ?? "cli";
    harnesses.push({
      instanceId: `${environmentId}:${definition.id}:${surface}:unavailable`,
      harnessId: definition.id,
      displayName: definition.displayName,
      surface,
      environmentId,
      status: "unavailable",
      supportLevel: definition.supportLevel,
      adapterId: definition.adapterId,
      modelDiscovery: "none",
      documentationUrl: definition.documentationUrl,
      repositoryUrl: definition.repositoryUrl,
    });
  }

  return { environments, harnesses, models, warnings, offline: context.offline };
}
