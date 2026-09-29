import { memo } from "react";
import { formatCost, formatDuration, type LaneState, laneElapsedMs } from "../state.ts";
import { Cube3D } from "./Cube3D.tsx";
import { Sparkline } from "./Sparkline.tsx";

export const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  running: "Solving",
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

function LaneImpl({ lane, now }: { lane: LaneState; now: number }) {
  const r = lane.result;
  const lastTurn = lane.turns.at(-1);
  const distance = lastTurn?.distanceAfter ?? r?.finalDistance;
  const initial = r?.initialDistance.value ?? lane.distance[0];
  const waiting = lane.waitingSinceClient !== undefined ? now - lane.waitingSinceClient : undefined;
  const c = lane.config;

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
        <span className={`badge badge-${lane.status}`}>{STATUS_LABEL[lane.status] ?? lane.status}</span>
      </header>

      <Cube3D
        label={`${c.label} cube, ${STATUS_LABEL[lane.status] ?? lane.status}`}
        state={lane.state}
        moves={lane.movesApplied}
      />

      <div className="timer" aria-live="off">
        <span className="timer-value">{formatDuration(laneElapsedMs(lane, now))}</span>
        {waiting !== undefined && (
          <span className="timer-sub">
            turn {lane.currentTurn} · thinking {formatDuration(waiting)}
          </span>
        )}
      </div>

      <dl className="stats">
        <Stat label="Turns" value={String(lane.turns.length)} />
        <Stat label="Moves" value={String(lane.movesApplied.length)} />
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

      {lane.distance.length > 0 && initial !== undefined && (
        <Sparkline
          values={[initial, ...lane.distance]}
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
