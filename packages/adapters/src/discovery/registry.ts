import type { HarnessDefinition, HarnessDetector, HarnessSurfaceDefinition, SupportLevel } from "./types.ts";

const noopDetector: HarnessDetector = { detect: async () => [] };

export const IDE_EXTENSION_IDS: Readonly<Record<string, readonly string[]>> = {
  codex: ["openai.chatgpt"],
  continue: ["Continue.continue"],
  cline: ["saoudrizwan.claude-dev"],
  "roo-code": ["RooVeterinaryInc.roo-cline"],
};

function cli(
  id: string,
  displayName: string,
  binaryName: string,
  supportLevel: SupportLevel,
  documentationUrl: `https://${string}`,
  repositoryUrl: `https://github.com/${string}/${string}`,
  adapterId?: string,
): HarnessDefinition {
  const surfaces: HarnessSurfaceDefinition[] = [{ surface: "cli", binaryNames: [binaryName] }];
  const extensionIds = IDE_EXTENSION_IDS[id];
  if (extensionIds) surfaces.push({ surface: "extension", extensionIds });
  return {
    id,
    displayName,
    surfaces,
    documentationUrl,
    repositoryUrl,
    releaseSource:
      id === "codex"
        ? {
            host: "api.github.com",
            owner: "openai",
            repository: "codex",
            includePrereleases: false,
          }
        : undefined,
    supportLevel,
    adapterId,
    detector: noopDetector,
  };
}

export const HARNESS_DEFINITIONS: readonly HarnessDefinition[] = [
  cli(
    "pi",
    "Pi coding agent",
    "pi",
    "verified-runnable",
    "https://pi.dev",
    "https://github.com/earendil-works/pi",
    "pi",
  ),
  cli(
    "kiro-cli",
    "Kiro CLI",
    "kiro-cli",
    "verified-runnable",
    "https://kiro.dev/docs/cli",
    "https://github.com/kirodotdev/Kiro",
    "kiro-cli",
  ),
  cli(
    "hermes",
    "Hermes Agent",
    "hermes",
    "verified-runnable",
    "https://hermes-agent.nousresearch.com",
    "https://github.com/NousResearch/hermes-agent",
    "hermes",
  ),
  cli(
    "codex",
    "OpenAI Codex",
    "codex",
    "catalog-only",
    "https://developers.openai.com/codex",
    "https://github.com/openai/codex",
  ),
  cli(
    "claude-code",
    "Claude Code",
    "claude",
    "catalog-only",
    "https://docs.anthropic.com/en/docs/claude-code",
    "https://github.com/anthropics/claude-code",
  ),
  cli(
    "gemini-cli",
    "Gemini CLI",
    "gemini",
    "catalog-only",
    "https://github.com/google-gemini/gemini-cli",
    "https://github.com/google-gemini/gemini-cli",
  ),
  cli(
    "opencode",
    "OpenCode",
    "opencode",
    "catalog-only",
    "https://opencode.ai/docs",
    "https://github.com/anomalyco/opencode",
  ),
  cli(
    "aider",
    "Aider",
    "aider",
    "catalog-only",
    "https://aider.chat/docs",
    "https://github.com/Aider-AI/aider",
  ),
  {
    id: "continue",
    displayName: "Continue",
    surfaces: [{ surface: "extension", extensionIds: IDE_EXTENSION_IDS.continue }],
    documentationUrl: "https://docs.continue.dev",
    repositoryUrl: "https://github.com/continuedev/continue",
    supportLevel: "catalog-only",
    detector: noopDetector,
  },
  {
    id: "cline",
    displayName: "Cline",
    surfaces: [{ surface: "extension", extensionIds: IDE_EXTENSION_IDS.cline }],
    documentationUrl: "https://docs.cline.bot",
    repositoryUrl: "https://github.com/cline/cline",
    supportLevel: "catalog-only",
    detector: noopDetector,
  },
  {
    id: "roo-code",
    displayName: "Roo Code",
    surfaces: [{ surface: "extension", extensionIds: IDE_EXTENSION_IDS["roo-code"] }],
    documentationUrl: "https://docs.roocode.com",
    repositoryUrl: "https://github.com/RooCodeInc/Roo-Code",
    supportLevel: "catalog-only",
    detector: noopDetector,
  },
];
