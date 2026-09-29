import type { CompletionRequest, CompletionResponse, ModelClient } from "@rubik-arena/bench-core";

export interface OpenAICompatibleOptions {
  /** e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://127.0.0.1:11434/v1 (Ollama) */
  baseUrl: string;
  model: string;
  /** Name of the environment variable that holds the API key (never the key itself). Optional for local servers. */
  apiKeyEnv?: string;
  /** Sent as `reasoning_effort` when set (OpenAI-style reasoning models). */
  reasoningEffort?: string;
  temperature?: number;
  /** Extra non-secret headers. */
  headers?: Record<string, string>;
}

export function resolveApiKey(
  apiKeyEnv: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!apiKeyEnv) return undefined;
  if (!/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv))
    throw new Error(`apiKeyEnv must be an env var name, got "${apiKeyEnv}"`);
  const key = env[apiKeyEnv];
  if (!key) throw new Error(`environment variable ${apiKeyEnv} is not set on the runner`);
  return key;
}

interface ChatChunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI Chat Completions (streaming SSE) — also OpenRouter, DeepSeek, Groq, vLLM, LM Studio, Ollama. */
export class OpenAICompatibleClient implements ModelClient {
  readonly kind = "llm" as const;
  private readonly url: string;

  constructor(readonly opts: OpenAICompatibleOptions) {
    const u = new URL(opts.baseUrl);
    if (u.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
      throw new Error("baseUrl must use https unless it points to localhost");
    }
    this.url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const key = resolveApiKey(this.opts.apiKeyEnv);
    const body: Record<string, unknown> = {
      model: this.opts.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    };
    if (this.opts.reasoningEffort) body.reasoning_effort = this.opts.reasoningEffort;
    if (this.opts.temperature !== undefined) body.temperature = this.opts.temperature;

    const res = await fetch(this.url, {
      method: "POST",
      signal: req.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...this.opts.headers,
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      throw new Error(`HTTP ${res.status} from ${new URL(this.url).host}: ${detail}`);
    }

    let text = "";
    let model: string | undefined;
    let usage: CompletionResponse["usage"];
    let first = true;
    let buffer = "";
    const decoder = new TextDecoder();
    const handle = (data: string) => {
      if (data === "[DONE]") return;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      model = chunk.model ?? model;
      const piece = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
      if (piece) {
        if (first) req.onFirstToken?.();
        first = false;
        text += piece;
      }
      if (chunk.usage)
        usage = { tokensIn: chunk.usage.prompt_tokens, tokensOut: chunk.usage.completion_tokens };
    };
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.startsWith("data:")) handle(line.slice(5).trim());
        idx = buffer.indexOf("\n");
      }
    }
    if (buffer.trim().startsWith("data:")) handle(buffer.trim().slice(5).trim());
    return { text, usage, model };
  }
}
