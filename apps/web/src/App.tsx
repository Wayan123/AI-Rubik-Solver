import type { ContestantConfig, RaceEvent } from "@rubik-arena/bench-core";
import { formatMoves } from "@rubik-arena/cube-engine";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type AdapterStatus,
  bootstrapToken,
  type DiscoveredHarness,
  type DiscoveredModel,
  type DiscoverySnapshot,
  type RaceSummary,
  RunnerApi,
} from "./api.ts";
import { ContestantEditor } from "./components/ContestantEditor.tsx";
import { HarnessCatalog } from "./components/HarnessCatalog.tsx";
import { Lane, type LaneReplay } from "./components/Lane.tsx";
import { Leaderboard } from "./components/Leaderboard.tsx";
import { ReplayToolbar } from "./components/ReplayToolbar.tsx";
import {
  DEFAULT_DRAFT,
  inputOf,
  resolveDraft,
  type ScrambleDraft,
  ScramblePanel,
} from "./components/ScramblePanel.tsx";
import { DEMO_ADAPTERS, runDemoRace } from "./demo.ts";
import { contestantFromDiscoveredModel, isContestantStale } from "./discovery.ts";
import { anyPlaying, buildTimeline, type LaneTimeline, replayReducer } from "./replay.ts";
import { emptyView, formatDuration, type RaceView, reduceRace } from "./state.ts";

type Connection =
  | { kind: "checking" }
  | { kind: "runner"; version: string }
  | { kind: "demo"; reason: string };

const DEMO_ADAPTER_LIST: AdapterStatus[] = [
  {
    id: "kociemba",
    name: "Kociemba solver (baseline)",
    kind: "baseline",
    auth: "none",
    description: "Two-phase algorithm. The reference for speed and move count.",
    thinkingLevels: [],
    modelHint: "",
    browserCapable: true,
    available: true,
  },
  {
    id: "random",
    name: "Random mover (baseline)",
    kind: "baseline",
    auth: "none",
    description: "Uniformly random moves. The floor any model should beat.",
    thinkingLevels: [],
    modelHint: "",
    browserCapable: true,
    available: true,
  },
  {
    id: "pi",
    name: "Pi coding agent",
    kind: "cli",
    auth: "cli-login",
    description: "",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    modelHint: "kiro/claude-opus-5-5",
    browserCapable: false,
    available: true,
  },
  {
    id: "kiro-cli",
    name: "Kiro CLI",
    kind: "cli",
    auth: "cli-login",
    description: "",
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
    modelHint: "claude-opus-5.5",
    browserCapable: false,
    available: true,
  },
];

const DEFAULTS = {
  mode: "interactive",
  maxTurns: 30,
  maxMovesPerTurn: 10,
  requestTimeoutMs: 600_000,
  runTimeoutMs: 1_800_000,
} as const;

const FALLBACK_PRESETS: ContestantConfig[] = [
  {
    id: "pi-opus55-high",
    label: "Opus 5.5 · high (Pi/Kiro)",
    adapter: "pi",
    model: "kiro/claude-opus-5-5",
    thinking: "high",
    ...DEFAULTS,
  },
  { id: "kociemba", label: "Kociemba", adapter: "kociemba", ...DEFAULTS },
];

const SOURCE_LABEL: Record<string, string> = {
  seeded: "Level scramble",
  moves: "Custom moves",
  state: "Custom cube state",
  "random-state": "Full random state",
};

/** Presets grouped by their `group` field, keeping file order. */
function groupPresets(list: ContestantConfig[]): Array<[string, ContestantConfig[]]> {
  const groups = new Map<string, ContestantConfig[]>();
  for (const p of list) {
    const g = p.group ?? "Other";
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  return [...groups.entries()];
}

let idCounter = 0;
const newId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function eventReducer(view: RaceView, action: { event: RaceEvent; now: number } | { reset: true }): RaceView {
  if ("reset" in action) return emptyView;
  return reduceRace(view, action.event, action.now);
}

async function waitForDiscovery(api: RunnerApi, generation: number): Promise<DiscoverySnapshot> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = await api.discoveryStatus();
    if (status.generation >= generation && status.state !== "scanning") return api.discovery();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Discovery scan is still running. Check again shortly.");
}

export function App() {
  const [token] = useState(() => bootstrapToken());
  const api = useMemo(() => new RunnerApi(token), [token]);
  const [conn, setConn] = useState<Connection>({ kind: "checking" });
  const [adapters, setAdapters] = useState<AdapterStatus[]>(DEMO_ADAPTER_LIST);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [discovery, setDiscovery] = useState<DiscoverySnapshot | null>(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [contestants, setContestants] = useState<ContestantConfig[]>(FALLBACK_PRESETS);
  const [presets, setPresets] = useState<ContestantConfig[]>(FALLBACK_PRESETS);
  const [draft, setDraft] = useState<ScrambleDraft>(DEFAULT_DRAFT);
  const [concurrency, setConcurrency] = useState(1);
  const [view, dispatch] = useReducer(eventReducer, emptyView);
  const [replay, replayDispatch] = useReducer(replayReducer, null);
  const [raceId, setRaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RaceSummary[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const demo = conn.kind === "demo";
  const running = view.status === "running";

  // Connection + discovery.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.health();
        if (!token) throw new Error("Open the link printed by `npm start` (it contains the access token).");
        const [ads, pre] = await Promise.all([api.adapters(), api.presets()]);
        if (cancelled) return;
        setConn({ kind: "runner", version: h.version });
        setAdapters(ads);
        if (pre.contestants?.length) {
          const filled = pre.contestants.map((c) => ({ ...DEFAULTS, ...c }));
          setPresets(filled);
          setContestants(filled.slice(0, 2));
        }
        setHistory((await api.races()).races);
        api
          .discovery()
          .then((snapshot) =>
            snapshot.state === "scanning" ? waitForDiscovery(api, snapshot.generation) : snapshot,
          )
          .then((snapshot) => {
            if (!cancelled) setDiscovery(snapshot);
          })
          .catch((discoveryFailure) => {
            if (!cancelled)
              setDiscoveryError(
                discoveryFailure instanceof Error ? discoveryFailure.message : String(discoveryFailure),
              );
          });
      } catch (e) {
        if (cancelled) return;
        setConn({ kind: "demo", reason: e instanceof Error ? e.message : String(e) });
        setAdapters(DEMO_ADAPTER_LIST);
        setContestants([
          { id: "kociemba", label: "Kociemba", adapter: "kociemba", ...DEFAULTS },
          { id: "random", label: "Random", adapter: "random", ...DEFAULTS, maxTurns: 10 },
        ]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, token]);

  // Ticking timer while running.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  const loadModels = useCallback(
    (adapterId: string) => {
      if (demo || models[adapterId]) return;
      setModels((m) => ({ ...m, [adapterId]: [] }));
      api
        .models(adapterId)
        .then((r) => setModels((m) => ({ ...m, [adapterId]: r.models })))
        .catch(() => {});
    },
    [api, demo, models],
  );

  const refreshDiscovery = async () => {
    if (demo || discoveryBusy) return;
    setDiscoveryBusy(true);
    setDiscoveryError(null);
    try {
      const accepted = await api.refreshDiscovery();
      setDiscovery(accepted);
      setDiscovery(await waitForDiscovery(api, accepted.generation));
    } catch (e) {
      setDiscoveryError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const addDiscoveredModel = (model: DiscoveredModel, harness: DiscoveredHarness) => {
    try {
      setContestants((current) => [...current, contestantFromDiscoveredModel(model, harness, newId())]);
    } catch (e) {
      setDiscoveryError(e instanceof Error ? e.message : String(e));
    }
  };

  const resolved = useMemo(() => resolveDraft(draft), [draft]);

  const onEvent = useCallback((event: RaceEvent) => dispatch({ event, now: Date.now() }), []);

  const start = async () => {
    setError(null);
    if (!resolved.ok) return setError(`Scramble: ${resolved.error}`);
    const input = inputOf(draft);
    if (!contestants.length) return setError("Add at least one contestant.");
    const blocked = contestants.find(
      (c) => demo && !DEMO_ADAPTERS.includes(c.adapter as (typeof DEMO_ADAPTERS)[number]),
    );
    if (blocked) return setError(`“${blocked.label}” needs the local runner. Start it with npm start.`);
    dispatch({ reset: true });
    replayDispatch({ type: "close" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setNow(Date.now());
    try {
      if (demo) {
        setRaceId(null);
        await runDemoRace({ scramble: resolved.scramble, contestants, concurrency }, onEvent, ctrl.signal);
        return;
      }
      const created = await api.createRace({
        scramble: {
          source: input.source,
          seed: input.seed,
          depth: input.depth,
          moves: resolved.scramble.moves,
          state: input.source === "state" ? resolved.scramble.state : undefined,
        },
        concurrency,
        contestants,
      });
      setRaceId(created.id);
      await api.streamEvents(created.id, onEvent, ctrl.signal);
      setHistory((await api.races()).races);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancel = async () => {
    if (raceId && !demo) await api.cancel(raceId).catch(() => {});
    else abortRef.current?.abort(new Error("cancelled by user"));
  };

  const openRace = async (id: string) => {
    setError(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ reset: true });
    replayDispatch({ type: "close" });
    setRaceId(id);
    try {
      await api.streamEvents(id, onEvent, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportRace = async () => {
    if (!raceId) return;
    const data = await api.race(raceId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rubik-arena-${raceId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const addContestant = (preset?: ContestantConfig) => {
    const base = preset ?? {
      label: "New contestant",
      adapter: demo ? "random" : "pi",
      model: demo ? undefined : "kiro/claude-opus-5-5",
      ...DEFAULTS,
    };
    setContestants((cs) => [...cs, { ...base, id: newId(), label: preset ? preset.label : base.label }]);
  };

  const lanes = useMemo(() => view.order.map((id) => view.lanes[id]!).filter(Boolean), [view]);
  const finished = view.status === "finished" || view.status === "cancelled";

  // Rebuild timelines only when a different race finishes (not on every re-render).
  const resultsKey = finished
    ? `${view.race?.id}:${lanes.map((l) => `${l.config.id}=${l.result?.movesApplied.length ?? -1}`).join(",")}`
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on resultsKey on purpose
  const timelines = useMemo(() => {
    if (!finished) return null;
    const out: Record<string, LaneTimeline> = {};
    for (const l of lanes) {
      if (l.result)
        out[l.config.id] = buildTimeline({
          turns: l.result.turns,
          movesApplied: l.result.movesApplied,
          wallMs: l.result.wallMs,
        });
    }
    return out;
  }, [resultsKey]);

  // A finished race (live or from history) opens in replay mode at its final position.
  useEffect(() => {
    if (timelines) replayDispatch({ type: "open", timelines });
  }, [timelines]);

  // Drive playback with requestAnimationFrame while anything is playing.
  const playing = anyPlaying(replay);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const loop = (t: number) => {
      replayDispatch({ type: "tick", dtMs: Math.min(250, t - last) });
      last = t;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const replayFor = (id: string): LaneReplay | undefined => {
    const timeline = replay?.timelines[id];
    const cursor = replay?.cursors[id];
    if (!timeline || !cursor || !view.initialState) return undefined;
    return {
      timeline,
      cursor,
      initialState: view.initialState,
      onToggle: () => replayDispatch({ type: "toggle", id }),
      onStep: (delta) => replayDispatch({ type: "step", id, delta }),
      onSeek: (pos) => replayDispatch({ type: "seek", id, pos }),
    };
  };

  return (
    <div className="app">
      <a href="#arena" className="skip">
        Skip to arena
      </a>
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="1" y="1" width="6.5" height="6.5" rx="1" fill="#f4f4f1" />
            <rect x="8.75" y="1" width="6.5" height="6.5" rx="1" fill="#c8352d" />
            <rect x="16.5" y="1" width="6.5" height="6.5" rx="1" fill="#2f9e5b" />
            <rect x="1" y="8.75" width="6.5" height="6.5" rx="1" fill="#2c64c6" />
            <rect x="8.75" y="8.75" width="6.5" height="6.5" rx="1" fill="#e8b33a" />
            <rect x="16.5" y="8.75" width="6.5" height="6.5" rx="1" fill="#ec7a2a" />
            <rect x="1" y="16.5" width="6.5" height="6.5" rx="1" fill="#2f9e5b" />
            <rect x="8.75" y="16.5" width="6.5" height="6.5" rx="1" fill="#f4f4f1" />
            <rect x="16.5" y="16.5" width="6.5" height="6.5" rx="1" fill="#c8352d" />
          </svg>
          <span>Rubik Arena</span>
        </div>
        <p className={`conn conn-${conn.kind}`} role="status">
          {conn.kind === "checking" && "Connecting to runner…"}
          {conn.kind === "runner" && `Local runner v${conn.version}`}
          {conn.kind === "demo" && "Demo mode — baselines only"}
        </p>
      </header>

      {conn.kind === "demo" && (
        <p className="banner" role="note">
          {conn.reason.includes("token") ? conn.reason : "No local runner found."} To race LLMs through your
          CLI logins (Pi, Kiro, …), run <code>npm start</code> and open the printed link.
        </p>
      )}

      <main className="layout">
        <aside className="setup" aria-labelledby="setup-title">
          <h2 id="setup-title">Race setup</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!running) void start();
            }}
          >
            <ScramblePanel draft={draft} disabled={running} onChange={setDraft} resolved={resolved} />
            <label className="field">
              <span>Run contestants</span>
              <select
                value={concurrency}
                disabled={running}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              >
                <option value={1}>One at a time</option>
                <option value={2}>2 in parallel</option>
                <option value={3}>3 in parallel</option>
                <option value={4}>4 in parallel</option>
              </select>
            </label>

            <h3 className="section-title">Contestants</h3>
            {contestants.map((c, i) => (
              <ContestantEditor
                key={c.id}
                value={c}
                adapters={adapters}
                models={models}
                disabled={running}
                demo={demo}
                stale={isContestantStale(c, discovery)}
                onChange={(next) => setContestants((cs) => cs.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setContestants((cs) => cs.filter((_, j) => j !== i))}
                onLoadModels={loadModels}
              />
            ))}
            <div className="row">
              <button type="button" className="btn" onClick={() => addContestant()} disabled={running}>
                Add contestant
              </button>
              {presets.length > 0 && (
                <select
                  className="preset-select"
                  aria-label="Add from preset"
                  value=""
                  disabled={running}
                  onChange={(e) => {
                    const p = presets.find((x) => x.id === e.target.value);
                    if (p) addContestant(p);
                  }}
                >
                  <option value="">Add preset…</option>
                  {groupPresets(presets).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>

            <HarnessCatalog
              snapshot={discovery}
              busy={discoveryBusy}
              error={discoveryError}
              onRefresh={() => void refreshDiscovery()}
              onAddModel={addDiscoveredModel}
            />

            <div className="actions">
              {running ? (
                <button type="button" className="btn btn-danger" onClick={() => void cancel()}>
                  Cancel race
                </button>
              ) : (
                <button type="submit" className="btn btn-primary">
                  Start race
                </button>
              )}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </aside>

        <section id="arena" className="arena" aria-labelledby="arena-title" tabIndex={-1}>
          <div className="arena-head">
            <h2 id="arena-title">Arena</h2>
            {view.race && (
              <p className="arena-meta">
                {view.race.scramble.moves.length > 0 ? (
                  <>
                    Scramble <code>{formatMoves(view.race.scramble.moves)}</code> ·{" "}
                    {view.race.scramble.moves.length} moves ·{" "}
                  </>
                ) : (
                  <>{SOURCE_LABEL[view.race.scramble.source ?? "state"]} · </>
                )}
                {view.status === "running" ? "running" : view.status}
                {raceId && !demo && view.status !== "running" && (
                  <>
                    {" "}
                    ·{" "}
                    <button type="button" className="link" onClick={() => void exportRace()}>
                      Export JSON
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
          {lanes.length === 0 ? (
            <div className="empty">
              <p>
                Pick contestants, choose a scramble and press <strong>Start race</strong>. Every contestant
                gets the same cube; the runner verifies each move and times every turn.
              </p>
              <p className="hint">
                Start small: depth 3–5 is already hard for most models. Distance-to-solved shows progress even
                when a model doesn’t finish.
              </p>
            </div>
          ) : (
            <>
              {replay && (
                <ReplayToolbar
                  state={replay}
                  onPlayAll={() => replayDispatch({ type: "play", ids: "all", restart: true })}
                  onResumeAll={() => replayDispatch({ type: "play", ids: "all" })}
                  onPauseAll={() => replayDispatch({ type: "pause", ids: "all" })}
                  onShowFinal={() => replayDispatch({ type: "open", timelines: replay.timelines })}
                  onMode={(mode) => replayDispatch({ type: "mode", mode })}
                  onSpeed={(speed) => replayDispatch({ type: "speed", ...speed })}
                />
              )}
              <div className="lanes">
                {lanes.map((l) => (
                  <Lane key={l.config.id} lane={l} now={now} replay={replayFor(l.config.id)} />
                ))}
              </div>
            </>
          )}
          <Leaderboard lanes={lanes} now={now} />

          {!demo && history.length > 0 && (
            <section className="panel" aria-labelledby="hist-title">
              <h2 id="hist-title">History</h2>
              <ul className="history">
                {history.slice(0, 20).map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="history-item"
                      onClick={() => void openRace(h.id)}
                      disabled={running}
                    >
                      <span className="history-date">{new Date(h.createdAt).toLocaleString()}</span>
                      <span className="history-meta">
                        {h.scrambleDepth
                          ? `depth ${h.scrambleDepth}`
                          : SOURCE_LABEL[h.scrambleSource ?? "state"]}
                        {h.startDistance
                          ? ` · ${h.startDistance.exact ? "" : "≤"}${h.startDistance.value} from solved`
                          : ""}{" "}
                        · {h.status}
                      </span>
                      <span className="history-people">
                        {h.contestants
                          .map(
                            (c) =>
                              `${c.label}: ${c.solved ? `✓ ${formatDuration(c.wallMs)}` : `${Math.round(c.progress * 100)}%`}`,
                          )
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      </main>
      <footer className="footer">
        <p>
          Moves are applied and verified by the harness, never trusted from the model. Distance is exact up to
          6–8 moves, otherwise a Kociemba upper bound (≤).
        </p>
      </footer>
    </div>
  );
}
