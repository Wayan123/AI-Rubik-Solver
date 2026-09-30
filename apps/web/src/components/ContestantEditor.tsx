import type { ContestantConfig } from "@rubik-arena/bench-core";
import { useId } from "react";
import type { AdapterStatus } from "../api.ts";

interface Props {
  value: ContestantConfig;
  adapters: AdapterStatus[];
  models: Record<string, string[]>;
  disabled: boolean;
  demo: boolean;
  stale?: boolean;
  onChange: (next: ContestantConfig) => void;
  onRemove: () => void;
  onLoadModels: (adapterId: string) => void;
}

const THINKING_LABEL: Record<string, string> = { off: "off", minimal: "minimal", xhigh: "x-high" };

export function ContestantEditor({
  value,
  adapters,
  models,
  disabled,
  demo,
  stale = false,
  onChange,
  onRemove,
  onLoadModels,
}: Props) {
  const uid = useId();
  const adapter = adapters.find((a) => a.id === value.adapter);
  const isBaseline = adapter?.kind === "baseline";
  const unavailable = adapter && (!adapter.available || (demo && !adapter.browserCapable));
  const set = <K extends keyof ContestantConfig>(k: K, v: ContestantConfig[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <fieldset className="contestant" disabled={disabled}>
      <legend className="sr-only">Contestant {value.label}</legend>
      <div className="contestant-head">
        <label className="field grow">
          <span>Label</span>
          <input value={value.label} maxLength={80} onChange={(e) => set("label", e.target.value)} />
        </label>
        <button type="button" className="icon-btn" aria-label={`Remove ${value.label}`} onClick={onRemove}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Source</span>
          <select
            value={value.adapter}
            onChange={(e) => {
              const next = adapters.find((a) => a.id === e.target.value);
              onChange({
                ...value,
                adapter: e.target.value,
                model: next?.modelHint || undefined,
                thinking: undefined,
              });
            }}
          >
            {adapters.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {!a.available ? " — not found" : demo && !a.browserCapable ? " — needs runner" : ""}
              </option>
            ))}
          </select>
        </label>
        {!isBaseline && (
          <label className="field">
            <span>Thinking / effort</span>
            <select
              value={value.thinking ?? ""}
              onChange={(e) => set("thinking", e.target.value || undefined)}
            >
              <option value="">default</option>
              {adapter?.thinkingLevels.map((t) => (
                <option key={t} value={t}>
                  {THINKING_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!isBaseline && (
        <label className="field">
          <span>Model</span>
          <input
            list={`${uid}-models`}
            value={value.model ?? ""}
            placeholder={adapter?.modelHint}
            spellCheck={false}
            autoCapitalize="off"
            onFocus={() => onLoadModels(value.adapter)}
            onChange={(e) => set("model", e.target.value.trim() || undefined)}
          />
          <datalist id={`${uid}-models`}>
            {(models[value.adapter] ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      )}
      {stale && (
        <p className="hint warn" role="status">
          Not present in the latest model catalog. You can keep this model ID or choose another.
        </p>
      )}
      {value.adapter === "hermes" && (
        <label className="field">
          <span>Hermes provider</span>
          <input
            value={String(value.options?.provider ?? "")}
            placeholder="openai-codex (ChatGPT/Codex login)"
            spellCheck={false}
            onChange={(e) =>
              set("options", {
                ...value.options,
                provider: e.target.value.replace(/[^\w.-]/g, "") || undefined,
              })
            }
          />
        </label>
      )}
      {value.adapter === "openai-compatible" && (
        <div className="grid-2">
          <label className="field">
            <span>Base URL</span>
            <input
              value={String(value.options?.baseUrl ?? "")}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              onChange={(e) => set("options", { ...value.options, baseUrl: e.target.value })}
            />
          </label>
          <label className="field">
            <span>API key env var</span>
            <input
              value={String(value.options?.apiKeyEnv ?? "")}
              placeholder="OPENAI_API_KEY"
              spellCheck={false}
              onChange={(e) =>
                set("options", {
                  ...value.options,
                  apiKeyEnv: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                })
              }
            />
          </label>
        </div>
      )}
      <div className="grid-3">
        <label className="field">
          <span>Mode</span>
          <select
            value={value.mode}
            onChange={(e) => set("mode", e.target.value as ContestantConfig["mode"])}
          >
            <option value="interactive">Interactive</option>
            <option value="one-shot">One-shot</option>
          </select>
        </label>
        <label className="field">
          <span>Max turns</span>
          <input
            type="number"
            min={1}
            max={200}
            value={value.maxTurns}
            disabled={value.mode === "one-shot"}
            onChange={(e) => set("maxTurns", Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="field">
          <span>Timeout (s)</span>
          <input
            type="number"
            min={5}
            max={3600}
            value={Math.round(value.requestTimeoutMs / 1000)}
            onChange={(e) =>
              set("requestTimeoutMs", Math.max(5, Math.min(3600, Number(e.target.value) || 60)) * 1000)
            }
          />
        </label>
      </div>
      {adapter && (
        <p className={`hint ${unavailable ? "warn" : ""}`}>
          {unavailable
            ? demo
              ? "Needs the local runner (npm start). Uses your CLI login; no API key."
              : `${adapter.name} was not found on this machine.`
            : adapter.auth === "cli-login"
              ? `Uses your ${adapter.name} login${adapter.version ? ` (${adapter.version})` : ""}. Tools are disabled.`
              : adapter.auth === "api-key"
                ? "Key is read from the env var on the runner, never sent to the browser."
                : adapter.description}
        </p>
      )}
    </fieldset>
  );
}
