import { formatMoves, type Move } from "@rubik-arena/cube-engine";
import type { LaneCursor, LaneTimeline } from "../replay.ts";
import { formatDuration } from "../state.ts";

interface Props {
  laneLabel: string;
  timeline: LaneTimeline;
  cursor: LaneCursor;
  onToggle: () => void;
  onStep: (delta: number) => void;
  onSeek: (pos: number) => void;
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
);
const PLAY = "M4 2.5v11l9-5.5z";
const PAUSE = "M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z";
const PREV = "M3 3h2v10H3zM14 3v10L6 8z";
const NEXT = "M11 3h2v10h-2zM2 3v10l8-5z";
const RESTART = "M8 3a5 5 0 1 1-4.6 3H1.5l2.8-3 2.8 3H4.9A3.5 3.5 0 1 0 8 4.5z";

/** Per-lane replay transport: restart, step back, play/pause, step forward, scrubber. */
export function ReplayControls({ laneLabel, timeline, cursor, onToggle, onStep, onSeek }: Props) {
  const total = timeline.moves.length;
  const pos = Math.floor(cursor.pos);
  const current: Move | undefined = timeline.moves[pos - 1];
  const next: Move | undefined = timeline.moves[pos];
  const turnIndex = pos > 0 ? (timeline.turnOf[pos - 1] ?? 0) + 1 : 0;
  const window = timeline.moves.slice(Math.max(0, pos - 4), pos);

  return (
    <div className="replay">
      <div className="replay-bar">
        <button
          type="button"
          className="icon-btn"
          aria-label={`Restart replay of ${laneLabel}`}
          onClick={() => onSeek(0)}
        >
          <Icon d={RESTART} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Previous move of ${laneLabel}`}
          disabled={pos === 0}
          onClick={() => onStep(-1)}
        >
          <Icon d={PREV} />
        </button>
        <button
          type="button"
          className="icon-btn play"
          aria-label={`${cursor.playing ? "Pause" : "Play"} replay of ${laneLabel}`}
          aria-pressed={cursor.playing}
          disabled={total === 0}
          onClick={onToggle}
        >
          <Icon d={cursor.playing ? PAUSE : PLAY} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Next move of ${laneLabel}`}
          disabled={pos >= total}
          onClick={() => onStep(1)}
        >
          <Icon d={NEXT} />
        </button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={total}
          step={1}
          value={pos}
          aria-label={`Replay position of ${laneLabel}`}
          aria-valuetext={`move ${pos} of ${total}`}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>
      <p className="replay-status" aria-live="polite">
        <span className="replay-pos">
          move {pos}/{total}
        </span>
        {turnIndex > 0 && <span> · turn {turnIndex}</span>}
        <span> · t = {formatDuration(cursor.clock)}</span>
        {current && (
          <span className="replay-moves">
            {" "}
            · <code className="dim">{formatMoves(window.slice(0, -1))}</code>{" "}
            <code className="now">{current}</code>
            {next ? <code className="dim"> → {next}</code> : null}
          </span>
        )}
      </p>
    </div>
  );
}
