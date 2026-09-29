import { MOVE_SPEEDS, type ReplayMode, type ReplayState, TIME_SCALES } from "../replay.ts";
import { formatDuration } from "../state.ts";

interface Props {
  state: ReplayState;
  onPlayAll: () => void;
  onResumeAll: () => void;
  onPauseAll: () => void;
  onShowFinal: () => void;
  onMode: (mode: ReplayMode) => void;
  onSpeed: (speed: { movesPerSecond?: number; timeScale?: number }) => void;
}

/** Controls that act on every lane at once: synchronized replay from the start, pause, mode and speed. */
export function ReplayToolbar({
  state,
  onPlayAll,
  onResumeAll,
  onPauseAll,
  onShowFinal,
  onMode,
  onSpeed,
}: Props) {
  const entries = Object.entries(state.cursors);
  const cursors = entries.map(([, c]) => c);
  const playing = cursors.some((c) => c.playing);
  const atEnd = entries.every(([id, c]) => Math.floor(c.pos) >= (state.timelines[id]?.moves.length ?? 0));
  const atStart = cursors.every((c) => c.pos === 0);
  const longest = Math.max(0, ...Object.values(state.timelines).map((t) => t.durationMs));
  const clock = Math.max(0, ...cursors.map((c) => c.clock));

  return (
    <section className="replay-toolbar" aria-label="Replay all contestants">
      <div className="row">
        <button type="button" className="btn btn-accent" onClick={onPlayAll}>
          Replay all from start
        </button>
        {playing ? (
          <button type="button" className="btn" onClick={onPauseAll}>
            Pause all
          </button>
        ) : (
          !atStart &&
          !atEnd && (
            <button type="button" className="btn" onClick={onResumeAll}>
              Resume all
            </button>
          )
        )}
        <button type="button" className="btn" onClick={onShowFinal}>
          Show final
        </button>
      </div>
      <div className="row replay-options">
        <fieldset className="segmented small">
          <legend className="sr-only">Replay pacing</legend>
          <button
            type="button"
            className={state.mode === "time" ? "seg active" : "seg"}
            aria-pressed={state.mode === "time"}
            title="Moves appear when each model actually answered — shows who was faster"
            onClick={() => onMode("time")}
          >
            Real time
          </button>
          <button
            type="button"
            className={state.mode === "moves" ? "seg active" : "seg"}
            aria-pressed={state.mode === "moves"}
            title="Every lane advances one move at a time at the same pace — compares the paths"
            onClick={() => onMode("moves")}
          >
            Move by move
          </button>
        </fieldset>
        <label className="field inline" htmlFor="replay-speed">
          <span>Speed</span>
          {state.mode === "time" ? (
            <select
              id="replay-speed"
              value={state.timeScale}
              onChange={(e) => onSpeed({ timeScale: Number(e.target.value) })}
            >
              {TIME_SCALES.map((x) => (
                <option key={x} value={x}>
                  {x}× ({formatDuration(longest / x)})
                </option>
              ))}
            </select>
          ) : (
            <select
              id="replay-speed"
              value={state.movesPerSecond}
              onChange={(e) => onSpeed({ movesPerSecond: Number(e.target.value) })}
            >
              {MOVE_SPEEDS.map((x) => (
                <option key={x} value={x}>
                  {x} move{x === 1 ? "" : "s"}/s
                </option>
              ))}
            </select>
          )}
        </label>
        {state.mode === "time" && (
          <p className="hint replay-clock" aria-live="off">
            race clock {formatDuration(clock)} / {formatDuration(longest)}
          </p>
        )}
      </div>
    </section>
  );
}
