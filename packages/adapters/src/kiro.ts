import type { CompletionRequest, CompletionResponse, ModelClient } from "@rubik-arena/bench-core";
import { CliError, spawnCli, tail } from "./spawn.ts";

export interface KiroOptions {
  /** Kiro model id, e.g. `claude-opus-5.5` (see `kiro-cli chat --list-models`). */
  model: string;
  /** low | medium | high | xhigh | max. Kiro may ignore it; the effective level is recorded in meta. */
  effort?: string;
  bin?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Kiro CLI argv. Engine v3 is required: v2 prints "failed to set model … Method not found" and silently
 * falls back to `auto`. `--trust-tools=` trusts no tools, so any tool call is refused in non-interactive mode.
 * The prompt is sent as one argument (system + user), since kiro-cli has no system-prompt flag.
 */
export function buildKiroArgs(opts: KiroOptions, req: Pick<CompletionRequest, "system" | "user">): string[] {
  const args = [
    "chat",
    "--agent-engine",
    "v3",
    "--no-interactive",
    "--trust-tools=",
    "--output-format",
    "stream-json",
  ];
  args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  args.push(`${req.system}\n\n---\n\n${req.user}`);
  return args;
}

export interface KiroParseState {
  chunks: string[];
  finalText?: string;
  status?: string;
  model?: string;
  effort?: string;
  credits: number;
  sawChunk: boolean;
}

export const newKiroState = (): KiroParseState => ({ chunks: [], credits: 0, sawChunk: false });

/** Feed one stream-json line. Returns true on the first text chunk. */
export function feedKiroLine(state: KiroParseState, line: string): boolean {
  let ev: {
    type?: string;
    data?: {
      status?: string;
      finalText?: string;
      update?: {
        sessionUpdate?: string;
        content?: { type?: string; text?: string };
        configOptions?: Array<{ id: string; currentValue?: string }>;
        _meta?: { kiro?: { kind?: string; promptTurnSummaries?: Array<{ unit?: string; usage?: number }> } };
      };
      meteringUsage?: Array<{ unit?: string; value?: number }>;
    };
  };
  try {
    ev = JSON.parse(line);
  } catch {
    return false;
  }
  const d = ev.data;
  if (ev.type === "runFinished") {
    state.finalText = d?.finalText;
    state.status = d?.status;
    return false;
  }
  if (ev.type === "metadata" && d?.meteringUsage) {
    for (const m of d.meteringUsage) if (m.unit === "credit") state.credits += m.value ?? 0;
    return false;
  }
  const u = d?.update;
  if (!u) return false;
  if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") {
    state.chunks.push(u.content.text ?? "");
    const first = !state.sawChunk;
    state.sawChunk = true;
    return first;
  }
  if (u.sessionUpdate === "config_option_update") {
    for (const c of u.configOptions ?? []) {
      if (c.id === "model") state.model = c.currentValue;
      if (c.id === "effortLevel") state.effort = c.currentValue;
    }
  }
  const k = u._meta?.kiro;
  if (k?.kind === "turn_completion") {
    for (const s of k.promptTurnSummaries ?? []) if (s.unit === "credit") state.credits += s.usage ?? 0;
  }
  return false;
}

export function kiroResponse(state: KiroParseState, requestedModel: string): CompletionResponse {
  if (state.status && state.status !== "success") throw new CliError(`kiro-cli run status: ${state.status}`);
  const text = state.finalText ?? state.chunks.join("");
  if (state.model && state.model !== requestedModel) {
    throw new CliError(`kiro-cli used model "${state.model}" instead of "${requestedModel}"`);
  }
  return {
    text,
    model: state.model ? `kiro/${state.model}` : undefined,
    cost: state.credits ? { value: state.credits, unit: "credit" } : undefined,
    meta: state.effort ? { effectiveEffort: state.effort } : undefined,
  };
}

export class KiroClient implements ModelClient {
  readonly kind = "llm" as const;
  constructor(readonly opts: KiroOptions) {
    if (!/^[\w.:-]+$/.test(opts.model)) throw new Error(`invalid kiro model "${opts.model}"`);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const state = newKiroState();
    const result = await spawnCli({
      command: this.opts.bin ?? process.env.RUBIK_KIRO_BIN ?? "kiro-cli",
      args: buildKiroArgs(this.opts, req),
      signal: req.signal,
      timeoutMs: req.timeoutMs,
      env: this.opts.env,
      onLine: (line) => {
        if (feedKiroLine(state, line)) req.onFirstToken?.();
      },
    });
    if (result.exitCode !== 0) {
      throw new CliError(
        `kiro-cli exited with code ${result.exitCode}: ${tail(result.stderr || result.stdout)}`,
        result,
      );
    }
    return kiroResponse(state, this.opts.model);
  }
}

export function parseKiroModelList(json: string): string[] {
  const parsed = JSON.parse(json) as { models?: Array<{ model_id?: string }> };
  return (parsed.models ?? []).map((m) => m.model_id).filter((m): m is string => Boolean(m));
}
