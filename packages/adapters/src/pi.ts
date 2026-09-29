import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CompletionRequest, CompletionResponse, ModelClient } from "@rubik-arena/bench-core";
import { CliError, spawnCli, tail } from "./spawn.ts";

export interface PiOptions {
  /** `provider/model`, e.g. `kiro/claude-opus-5-5`. */
  model: string;
  /** off | minimal | low | medium | high | xhigh | max */
  thinking?: string;
  /** Pi executable (default `pi`, override with RUBIK_PI_BIN). */
  bin?: string;
  /** Explicit provider extension paths (`-e`). Default: auto-resolve `pi-provider-<provider>` from the Pi agent dir. */
  extensions?: string[];
  env?: Record<string, string | undefined>;
}

/** Providers Pi ships natively (no extension needed). */
const BUILTIN_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "openai-codex",
  "google",
  "google-vertex",
  "github-copilot",
  "openrouter",
  "groq",
  "xai",
  "mistral",
  "cerebras",
  "amazon-bedrock",
  "deepseek",
  "ollama",
]);

export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/** Resolve extension paths for a non-built-in provider (e.g. `kiro` → `…/npm/node_modules/pi-provider-kiro`). */
export function resolveProviderExtensions(model: string, explicit?: string[]): string[] {
  if (explicit?.length) return explicit;
  const fromEnv = process.env.PI_PROVIDER_EXTENSIONS?.split(",").filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  const provider = model.includes("/") ? model.split("/")[0]! : "";
  if (!provider || BUILTIN_PROVIDERS.has(provider)) return [];
  const candidate = join(piAgentDir(), "npm", "node_modules", `pi-provider-${provider}`);
  return existsSync(candidate) ? [candidate] : [];
}

/**
 * Build Pi argv. Everything that could let the model act on the machine or leak user context is disabled:
 * no tools, no skills, no context files, no prompt templates, no user extensions, no saved session.
 */
export function buildPiArgs(opts: PiOptions, req: Pick<CompletionRequest, "system" | "user">): string[] {
  const args = [
    "-p",
    "--mode",
    "json",
    "--no-session",
    "--no-tools",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-extensions",
  ];
  for (const ext of resolveProviderExtensions(opts.model, opts.extensions)) args.push("-e", ext);
  args.push("--model", opts.model);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  args.push("--system-prompt", req.system, req.user);
  return args;
}

interface PiAssistantMessage {
  role: string;
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  provider?: string;
  usage?: { input?: number; output?: number; cost?: { total?: number } };
  stopReason?: string;
  errorMessage?: string;
}

export interface PiParseState {
  text: string;
  message?: PiAssistantMessage;
  sawDelta: boolean;
}

/** Feed one JSONL line from `pi --mode json`. Returns true when the line carried the first text delta. */
export function feedPiLine(state: PiParseState, line: string): boolean {
  let event: { type?: string; message?: PiAssistantMessage; assistantMessageEvent?: { type?: string } };
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent?.type === "text_delta" &&
    !state.sawDelta
  ) {
    state.sawDelta = true;
    return true;
  }
  if ((event.type === "turn_end" || event.type === "message_end") && event.message?.role === "assistant") {
    state.message = event.message;
    state.text = (event.message.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
  }
  return false;
}

export function piResponse(state: PiParseState): CompletionResponse {
  const m = state.message;
  if (!m) throw new CliError("pi produced no assistant message");
  if (m.stopReason === "error" || m.errorMessage)
    throw new CliError(`pi: ${m.errorMessage ?? "provider error"}`);
  const total = m.usage?.cost?.total;
  return {
    text: state.text,
    usage: { tokensIn: m.usage?.input, tokensOut: m.usage?.output },
    cost: total ? { value: total, unit: "USD" } : undefined,
    model: m.provider && m.model ? `${m.provider}/${m.model}` : m.model,
  };
}

export class PiClient implements ModelClient {
  readonly kind = "llm" as const;
  constructor(readonly opts: PiOptions) {
    if (!/^[\w.-]+\/[\w.:-]+$/.test(opts.model))
      throw new Error(`pi model must be "provider/model", got "${opts.model}"`);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const state: PiParseState = { text: "", sawDelta: false };
    const result = await spawnCli({
      command: this.opts.bin ?? process.env.RUBIK_PI_BIN ?? "pi",
      args: buildPiArgs(this.opts, req),
      signal: req.signal,
      timeoutMs: req.timeoutMs,
      env: this.opts.env,
      onLine: (line) => {
        if (feedPiLine(state, line)) req.onFirstToken?.();
      },
    });
    if (result.exitCode !== 0) {
      throw new CliError(
        `pi exited with code ${result.exitCode}: ${tail(result.stderr || result.stdout)}`,
        result,
      );
    }
    return piResponse(state);
  }
}

/** List models via `pi --list-models [search]` (table output). */
export function parsePiModelList(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[0] !== "provider" && /^[\w.-]+$/.test(cols[0]!))
    .map((cols) => `${cols[0]}/${cols[1]}`);
}
