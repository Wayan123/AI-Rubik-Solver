import type { Contestant, ContestantConfig } from "@rubik-arena/bench-core";
import { KociembaSolver, RandomSolver } from "./baselines.ts";
import { KiroClient, parseKiroModelList } from "./kiro.ts";
import { OpenAICompatibleClient } from "./openai.ts";
import { PiClient, parsePiModelList } from "./pi.ts";
import { probeVersion, spawnCli } from "./spawn.ts";

export type AdapterKind = "cli" | "api" | "baseline";

export interface AdapterInfo {
  id: string;
  name: string;
  kind: AdapterKind;
  /** How the user authenticates. */
  auth: "cli-login" | "api-key" | "none";
  description: string;
  /** Thinking/effort levels this adapter understands. */
  thinkingLevels: string[];
  /** Placeholder shown in the model field. */
  modelHint: string;
  /** Runs inside the browser in demo mode. */
  browserCapable: boolean;
}

export interface AdapterStatus extends AdapterInfo {
  available: boolean;
  version?: string;
}

interface AdapterDefinition extends AdapterInfo {
  create(config: ContestantConfig): Contestant;
  detect(): Promise<{ available: boolean; version?: string }>;
  listModels?(search?: string): Promise<string[]>;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const strList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

function requireModel(config: ContestantConfig): string {
  if (!config.model) throw new Error(`contestant "${config.label}" needs a model`);
  return config.model;
}

const cliDetect = (bin: string) => async () => {
  const version = await probeVersion(bin);
  return version ? { available: true, version } : { available: false };
};

const DEFINITIONS: AdapterDefinition[] = [
  {
    id: "pi",
    name: "Pi coding agent",
    kind: "cli",
    auth: "cli-login",
    description:
      "Runs `pi -p` with all tools, skills, context files and user extensions disabled. Uses whatever providers you are logged into in Pi (Kiro, Codex/ChatGPT, Copilot, Antigravity, …).",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    modelHint: "kiro/claude-opus-5-5",
    browserCapable: false,
    create: (c) =>
      new PiClient({
        model: requireModel(c),
        thinking: c.thinking,
        extensions: strList(c.options?.extensions),
      }),
    detect: cliDetect(process.env.RUBIK_PI_BIN ?? "pi"),
    async listModels(search) {
      const r = await spawnCli({
        command: process.env.RUBIK_PI_BIN ?? "pi",
        args: ["--list-models", ...(search ? [search] : [])],
        signal: AbortSignal.timeout(60_000),
        timeoutMs: 60_000,
      });
      return parsePiModelList(r.stdout);
    },
  },
  {
    id: "kiro-cli",
    name: "Kiro CLI",
    kind: "cli",
    auth: "cli-login",
    description:
      "Runs `kiro-cli chat --agent-engine v3 --no-interactive --trust-tools=` using your Kiro login. Reports Kiro credits.",
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
    modelHint: "claude-opus-5.5",
    browserCapable: false,
    create: (c) => new KiroClient({ model: requireModel(c), effort: c.thinking }),
    detect: cliDetect(process.env.RUBIK_KIRO_BIN ?? "kiro-cli"),
    async listModels() {
      const r = await spawnCli({
        command: process.env.RUBIK_KIRO_BIN ?? "kiro-cli",
        args: ["chat", "--list-models", "--format", "json"],
        signal: AbortSignal.timeout(60_000),
        timeoutMs: 60_000,
      });
      return parseKiroModelList(r.stdout);
    },
  },
  {
    id: "openai-compatible",
    name: "OpenAI-compatible API (BYOK)",
    kind: "api",
    auth: "api-key",
    description:
      "Any Chat Completions endpoint: OpenAI, OpenRouter, DeepSeek, Groq, Together, vLLM, LM Studio, Ollama (`http://127.0.0.1:11434/v1`). The key is read from an env var on the runner.",
    thinkingLevels: ["minimal", "low", "medium", "high"],
    modelHint: "gpt-5.6-terra",
    browserCapable: false,
    create: (c) =>
      new OpenAICompatibleClient({
        baseUrl: str(c.options?.baseUrl) ?? "https://api.openai.com/v1",
        model: requireModel(c),
        apiKeyEnv: str(c.options?.apiKeyEnv),
        reasoningEffort: c.thinking,
      }),
    detect: async () => ({ available: true }),
  },
  {
    id: "kociemba",
    name: "Kociemba solver (baseline)",
    kind: "baseline",
    auth: "none",
    description: "Two-phase algorithm (cubejs). Not an LLM — the reference for speed and move count.",
    thinkingLevels: [],
    modelHint: "",
    browserCapable: true,
    create: () => new KociembaSolver(),
    detect: async () => ({ available: true }),
  },
  {
    id: "random",
    name: "Random mover (baseline)",
    kind: "baseline",
    auth: "none",
    description: "Uniformly random moves, 10 per turn. The floor any model should beat.",
    thinkingLevels: [],
    modelHint: "",
    browserCapable: true,
    create: (c) => new RandomSolver(Number(c.options?.seed ?? 1), c.maxMovesPerTurn),
    detect: async () => ({ available: true }),
  },
];

const BY_ID = new Map(DEFINITIONS.map((d) => [d.id, d]));

export function adapterInfos(): AdapterInfo[] {
  return DEFINITIONS.map(({ create: _c, detect: _d, listModels: _l, ...info }) => info);
}

export async function detectAdapters(): Promise<AdapterStatus[]> {
  return Promise.all(
    DEFINITIONS.map(async ({ create: _c, detect, listModels: _l, ...info }) => ({
      ...info,
      ...(await detect()),
    })),
  );
}

export async function listModels(adapterId: string, search?: string): Promise<string[]> {
  const def = BY_ID.get(adapterId);
  if (!def) throw new Error(`unknown adapter "${adapterId}"`);
  return def.listModels ? def.listModels(search) : [];
}

export function createContestant(config: ContestantConfig): Contestant {
  const def = BY_ID.get(config.adapter);
  if (!def) throw new Error(`unknown adapter "${config.adapter}"`);
  return def.create(config);
}

export function hasAdapter(id: string): boolean {
  return BY_ID.has(id);
}
