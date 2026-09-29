import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompletionRequest, CompletionResponse, ModelClient } from "@rubik-arena/bench-core";
import { CliError, spawnCli, tail } from "./spawn.ts";

export interface HermesOptions {
  /** Hermes model id, e.g. `gpt-6-astra` (resolved by the provider below). */
  model: string;
  /** Hermes provider override, e.g. `openai-codex` (ChatGPT/Codex login). Default: Hermes config. */
  provider?: string;
  /** none | minimal | low | medium | high | xhigh | max | ultra */
  reasoning?: string;
  bin?: string;
  env?: Record<string, string | undefined>;
}

/**
 * The only toolset passed to Hermes. `-t ""` is treated by Hermes as "not given" and falls back to the
 * user's configured toolsets (terminal, file, …) — observed writing a file into $HOME. `clarify` contains only
 * the harmless ask-the-user tool, so the model has no way to act on the machine.
 */
export const HERMES_SAFE_TOOLSET = "clarify";

export function buildHermesArgs(
  opts: HermesOptions,
  req: Pick<CompletionRequest, "system" | "user">,
  usageFile: string,
): string[] {
  const args = ["-z", `${req.system}\n\n---\n\n${req.user}`, "--ignore-rules", "-t", HERMES_SAFE_TOOLSET];
  args.push("--usage-file", usageFile, "-m", opts.model);
  if (opts.provider) args.push("--provider", opts.provider);
  if (opts.reasoning) args.push("--reasoning", opts.reasoning);
  return args;
}

interface HermesUsage {
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  model?: string;
  provider?: string;
  failed?: boolean;
  turn_exit_reason?: string;
}

export function hermesResponse(stdout: string, usage: HermesUsage | undefined): CompletionResponse {
  if (usage?.failed) throw new CliError(`hermes run failed: ${usage.turn_exit_reason ?? "unknown reason"}`);
  const text = stdout.trim();
  if (!text) throw new CliError("hermes produced no answer");
  return {
    text,
    usage: { tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens },
    cost: usage?.estimated_cost_usd ? { value: usage.estimated_cost_usd, unit: "USD" } : undefined,
    model: usage?.model ? `${usage.provider ? `${usage.provider}/` : ""}${usage.model}` : undefined,
  };
}

/** Hermes Agent one-shot mode (`hermes -z`), using whatever login Hermes has (e.g. ChatGPT/Codex). */
export class HermesClient implements ModelClient {
  readonly kind = "llm" as const;
  constructor(readonly opts: HermesOptions) {
    if (!/^[\w.:/-]+$/.test(opts.model)) throw new Error(`invalid hermes model "${opts.model}"`);
    if (opts.provider && !/^[\w.-]+$/.test(opts.provider))
      throw new Error(`invalid hermes provider "${opts.provider}"`);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const dir = await mkdtemp(join(tmpdir(), "rubik-arena-hermes-"));
    const usageFile = join(dir, "usage.json");
    try {
      let first = true;
      const result = await spawnCli({
        command: this.opts.bin ?? process.env.RUBIK_HERMES_BIN ?? "hermes",
        args: buildHermesArgs(this.opts, req, usageFile),
        cwd: dir,
        signal: req.signal,
        timeoutMs: req.timeoutMs,
        env: this.opts.env,
        onLine: () => {
          if (first) req.onFirstToken?.();
          first = false;
        },
      });
      if (result.exitCode !== 0) {
        throw new CliError(
          `hermes exited with code ${result.exitCode}: ${tail(result.stderr || result.stdout)}`,
          result,
        );
      }
      let usage: HermesUsage | undefined;
      try {
        usage = JSON.parse(await readFile(usageFile, "utf8")) as HermesUsage;
      } catch {
        usage = undefined;
      }
      return hermesResponse(result.stdout, usage);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
