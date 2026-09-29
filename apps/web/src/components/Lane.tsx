import { applyMoves, type CubeState } from "@rubik-arena/cube-engine";
import { memo, useMemo } from "react";
import { completedTurn, type LaneCursor, type LaneTimeline } from "../replay.ts";
import { formatCost, formatDuration, type LaneState, laneElapsedMs } from "../state.ts";
import { Cube3D } from "./Cube3D.tsx";
import { ReplayControls } from "./ReplayControls.tsx";
import { Sparkline } from "./Sparkline.tsx";

export interface LaneReplay {
  timeline: LaneTimeline;
  cursor: LaneCursor;
  initialState: CubeState;
  onToggle: () => void;
  onStep: (delta: number) => void;
  onSeek: (pos: number) => void;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  running: "Solving",
  replay: "Replaying",
  paused: "Paused",
  solved: "Solved",
  unsolved: "Not solved",
  error: "Error",
  timeout: "Timed out",
  cancelled: "Cancelled",
};

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LaneImpl({ lane, now, replay }: { lane: LaneState; now: number; replay?: LaneReplay }) {
  const r = lane.result;
  const c = lane.config;

  // In replay, everything below reflects the replay position instead of the final result.
  const pos = replay ? Math.floor(replay.cursor.pos) : lane.movesApplied.length;
  const replayMoves = useMemo(() => (replay ? replay.timeline.moves.slice(0, pos) : null), [replay, pos]);
  const replayState = useMemo(
    () => (replay && replayMoves ? applyMoves(replay.initialState, replayMoves) : null),
    [replay, replayMoves],
  );
  const shownTurns = replay ? lane.turns.slice(0, completedTurn(replay.timeline, pos) + 1) : lane.turns;
  const lastTurn = shownTurns.at(-1);
  const distance = replay
    ? pos === 0
      ? r?.initialDistance
      : (lastTurn?.distanceAfter ?? r?.initialDistance)
    : (lastTurn?.distanceAfter ?? r?.finalDistance);
  const initial = r?.initialDistance.value ?? lane.distance[0];
  const sparkValues = replay ? shownTurns.map((t) => t.distanceAfter.value) : lane.distance;
  const replayDone = replay ? pos >= replay.timeline.moves.length && !replay.cursor.playing : false;
  const waiting =
    !replay && lane.waitingSinceClient !== undefined ? now - lane.waitingSinceClient : undefined;
  const badge = replay && !replayDone ? (replay.cursor.playing ? "replay" : "paused") : lane.status;

  return (
    <article className={`lane status-${lane.status}`} aria-labelledby={`lane-${c.id}`}>
      <header className="lane-head">
        <div className="lane-title">
          <h3 id={`lane-${c.id}`}>{c.label}</h3>
          <p className="lane-sub">
            {c.adapter}
            {c.model ? ` · ${c.model}` : ""}
            {c.thinking ? ` · ${c.thinking}` : ""} · {c.mode}
          </p>
        </div>
        <span className={`badge badge-${badge}`}>{STATUS_LABEL[badge] ?? badge}</span>
      </header>

      <Cube3D
        label={`${c.label} cube, ${replay ? `replay move ${pos}` : (STATUS_LABEL[lane.status] ?? lane.status)}`}
        state={replayState ?? lane.state}
        moves={replayMoves ?? lane.movesApplied}
      />

      {replay && (
        <ReplayControls
          laneLabel={c.label}
          timeline={replay.timeline}
          cursor={replay.cursor}
          onToggle={replay.onToggle}
          onStep={replay.onStep}
          onSeek={replay.onSeek}
        />
      )}

      <div className="timer" aria-live="off">
        <span className="timer-value">
          {formatDuration(replay ? replay.cursor.clock : laneElapsedMs(lane, now))}
        </span>
        {replay && r && <span className="timer-sub">of {formatDuration(r.wallMs)}</span>}
        {waiting !== undefined && (
          <span className="timer-sub">
            turn {lane.currentTurn} · thinking {formatDuration(waiting)}
          </span>
        )}
      </div>

      <dl className="stats">
        <Stat label="Turns" value={String(shownTurns.length)} />
        <Stat label="Moves" value={String(pos)} />
        <Stat
          label="Distance"
          value={distance ? `${distance.exact ? "" : "≤"}${distance.value}` : "—"}
          title={distance?.exact ? "Exact moves to solved" : "Upper bound (Kociemba two-phase)"}
        />
        <Stat
          label="Progress"
          value={r ? `${Math.round(r.progress * 100)}%` : "—"}
          title="(initial − best) / initial"
        />
        <Stat
          label="1st token"
          value={lastTurn?.ttftMs !== undefined ? formatDuration(lastTurn.ttftMs) : "—"}
        />
        <Stat
          label="Tokens"
          value={
            r && (r.tokensIn || r.tokensOut)
              ? `${r.tokensIn.toLocaleString()} / ${r.tokensOut.toLocaleString()}`
              : "—"
          }
          title="input / output"
        />
        <Stat
          label="Invalid"
          value={String(r?.invalidOutputs ?? lane.turns.filter((t) => !t.valid).length)}
        />
        <Stat label="Cost" value={r?.cost.length ? formatCost(r.cost) : "—"} />
      </dl>

      {sparkValues.length > 0 && initial !== undefined && (
        <Sparkline
          values={[initial, ...sparkValues]}
          label={`Distance to solved over turns for ${c.label}`}
        />
      )}

      {r?.error && <p className="lane-error">{r.error}</p>}
      {r?.reportedModel && r.reportedModel !== c.model && (
        <p className="hint">Reported model: {r.reportedModel}</p>
      )}
      {typeof r?.meta?.effectiveEffort === "string" && r.meta.effectiveEffort !== c.thinking && (
        <p className="hint warn">CLI reported effort “{r.meta.effectiveEffort}”.</p>
      )}

      {lastTurn && (
        <details className="raw">
          <summary>
            Last answer (turn {lastTurn.turn}, {formatDuration(lastTurn.latencyMs)})
            {lastTurn.valid ? "" : " — invalid"}
          </summary>
          <pre>{lastTurn.rawText || "(empty)"}</pre>
        </details>
      )}
    </article>
  );
}

export const Lane = memo(LaneImpl);
