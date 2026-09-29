import {
  DIFFICULTY_PRESETS,
  distanceToSolved,
  type Face,
  formatMoves,
  invertMoves,
  normalizeStateInput,
  type ResolveResult,
  resolveScramble,
  type ScrambleInput,
  type ScrambleSource,
  SOLVED,
} from "@rubik-arena/cube-engine";
import { useEffect, useId, useMemo, useState } from "react";
import { FACE_COLORS } from "./Cube3D.tsx";

export interface ScrambleDraft {
  source: ScrambleSource;
  preset: string;
  seed: number;
  depth: number;
  moves: string;
  state: string;
}

export const DEFAULT_DRAFT: ScrambleDraft = {
  source: "seeded",
  preset: "easy",
  seed: 2026,
  depth: 3,
  moves: "",
  state: "",
};

const SOURCES: Array<{ id: ScrambleSource; label: string; help: string }> = [
  {
    id: "seeded",
    label: "Level",
    help: "Random face turns from a seed. Pick a level or set the depth yourself.",
  },
  {
    id: "moves",
    label: "My moves",
    help: "Your own scramble, e.g. a WCA scramble or a pattern. The cube starts after these moves.",
  },
  {
    id: "state",
    label: "My cube",
    help: "Enter the 54 stickers of a real cube, face by face. The state is checked for solvability.",
  },
  {
    id: "random-state",
    label: "Full random",
    help: "A uniformly random reachable cube (like competition scrambles) from a seed.",
  },
];

const FACE_ORDER: Face[] = ["U", "R", "F", "D", "L", "B"];
const STICKER_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
const FACE_LABEL: Record<Face, string> = {
  U: "Up (white centre)",
  R: "Right (red)",
  F: "Front (green)",
  D: "Down (yellow)",
  L: "Left (orange)",
  B: "Back (blue)",
};

/** Small patterns people know; they give recognisable, reproducible difficulty. */
const PATTERNS: Array<{ name: string; moves: string }> = [
  { name: "Sexy move ×1", moves: "R U R' U'" },
  { name: "T-perm", moves: "R U R' U' R' F R2 U' R' U' R U R' F'" },
  { name: "Sune", moves: "R U R' U R U2 R'" },
  { name: "Checkerboard", moves: "U2 D2 F2 B2 L2 R2" },
  { name: "Superflip (20, hardest known)", moves: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2" },
];

export function inputOf(d: ScrambleDraft): ScrambleInput {
  switch (d.source) {
    case "seeded":
      return { source: "seeded", seed: d.seed, depth: d.depth };
    case "moves":
      return { source: "moves", moves: d.moves };
    case "state":
      return { source: "state", state: d.state };
    case "random-state":
      return { source: "random-state", seed: d.seed };
  }
}

/** Flat 2D net preview of a facelet state. */
export function NetPreview({ state, label }: { state: string; label: string }) {
  const size = 11;
  const gap = 1;
  const faceSize = size * 3 + gap * 2;
  const offsets: Record<Face, [number, number]> = {
    U: [1, 0],
    L: [0, 1],
    F: [1, 1],
    R: [2, 1],
    B: [3, 1],
    D: [1, 2],
  };
  const cells = FACE_ORDER.flatMap((f, fi) =>
    STICKER_SLOTS.map((i) => {
      const [ox, oy] = offsets[f];
      const x = ox * (faceSize + 3) + (i % 3) * (size + gap);
      const y = oy * (faceSize + 3) + Math.floor(i / 3) * (size + gap);
      const c = state[fi * 9 + i] as Face | undefined;
      return (
        <rect
          key={`${f}${i}`}
          x={x}
          y={y}
          width={size}
          height={size}
          rx={1.5}
          fill={c ? FACE_COLORS[c] : "#555"}
        />
      );
    }),
  );
  return (
    <svg
      className="net"
      viewBox={`0 0 ${4 * (faceSize + 3)} ${3 * (faceSize + 3)}`}
      role="img"
      aria-label={label}
    >
      {cells}
    </svg>
  );
}

function StateEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [paint, setPaint] = useState<Face>("U");
  const typed = normalizeStateInput(value);
  const current = typed.length === 54 ? typed : SOLVED;
  const setSticker = (i: number) => {
    if (i % 9 === 4) return; // centres are fixed
    onChange(current.slice(0, i) + paint + current.slice(i + 1));
  };
  return (
    <div className="state-editor">
      <div className="palette">
        <span className="sr-only">Sticker colour to paint</span>
        {FACE_ORDER.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={paint === f}
            aria-label={`Paint ${FACE_LABEL[f]}`}
            className="swatch"
            style={{ background: FACE_COLORS[f] }}
            onClick={() => setPaint(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="faces">
        {FACE_ORDER.map((f, fi) => (
          <fieldset key={f} className="face-grid">
            <legend className="face-name">
              {f}
              <span className="sr-only"> — {FACE_LABEL[f]}</span>
            </legend>
            {STICKER_SLOTS.map((i) => {
              const idx = fi * 9 + i;
              const c = current[idx] as Face;
              return (
                <button
                  key={idx}
                  type="button"
                  className="sticker"
                  disabled={i === 4}
                  style={{ background: FACE_COLORS[c] }}
                  aria-label={`${FACE_LABEL[f]} sticker ${i + 1}: ${c}${i === 4 ? " (centre, fixed)" : ""}`}
                  onClick={() => setSticker(idx)}
                />
              );
            })}
          </fieldset>
        ))}
      </div>
      <p className="hint">
        Click a colour, then click stickers. Hold the cube with white on top and green in front; read each
        face row by row as you look at it (Back: with white on top; Down: with green on top).
      </p>
    </div>
  );
}

interface Props {
  draft: ScrambleDraft;
  disabled: boolean;
  onChange: (d: ScrambleDraft) => void;
  resolved: ResolveResult;
}

export function ScramblePanel({ draft, disabled, onChange, resolved }: Props) {
  const uid = useId();
  const set = (patch: Partial<ScrambleDraft>) => onChange({ ...draft, ...patch });
  const source = SOURCES.find((s) => s.id === draft.source)!;

  // Distance of the start cube (exact when ≤ 8). Deferred so typing stays responsive.
  const [distance, setDistance] = useState<{ value: number; exact: boolean } | null>(null);
  const startState = resolved.ok ? resolved.scramble.state : null;
  useEffect(() => {
    setDistance(null);
    if (!startState) return;
    const t = setTimeout(() => setDistance(distanceToSolved(startState, { mode: "fast" })), 150);
    return () => clearTimeout(t);
  }, [startState]);

  const solutionHint = useMemo(
    () =>
      resolved.ok && resolved.scramble.moves.length
        ? formatMoves(invertMoves(resolved.scramble.moves))
        : null,
    [resolved],
  );

  return (
    <fieldset className="panel-inner" disabled={disabled}>
      <legend>Scramble</legend>

      <div className="segmented">
        <span className="sr-only">Where the start cube comes from</span>
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={draft.source === s.id}
            className={draft.source === s.id ? "seg active" : "seg"}
            onClick={() =>
              set(
                s.id === "state" && !draft.state.trim()
                  ? { source: s.id, state: resolved.ok ? resolved.scramble.state : SOLVED }
                  : { source: s.id },
              )
            }
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="hint">{source.help}</p>

      {draft.source === "seeded" && (
        <>
          <label className="field">
            <span>Difficulty</span>
            <select
              value={draft.preset}
              onChange={(e) => {
                const p = DIFFICULTY_PRESETS.find((x) => x.id === e.target.value);
                if (!p) return set({ preset: "custom" });
                if (p.input.source === "random-state") return set({ preset: p.id, source: "random-state" });
                set({ preset: p.id, depth: p.input.depth ?? draft.depth });
              }}
            >
              {DIFFICULTY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom depth</option>
            </select>
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Depth (random turns)</span>
              <input
                type="number"
                min={1}
                max={100}
                value={draft.depth}
                onChange={(e) =>
                  set({
                    preset: "custom",
                    depth: Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))),
                  })
                }
              />
            </label>
            <SeedField seed={draft.seed} onChange={(seed) => set({ seed })} />
          </div>
        </>
      )}

      {draft.source === "random-state" && <SeedField seed={draft.seed} onChange={(seed) => set({ seed })} />}

      {draft.source === "moves" && (
        <>
          <label className="field">
            <span>Scramble moves</span>
            <textarea
              rows={3}
              value={draft.moves}
              placeholder="e.g. R U R' U' F2 D L' B2"
              spellCheck={false}
              autoCapitalize="off"
              aria-invalid={!resolved.ok}
              aria-describedby={`${uid}-status`}
              onChange={(e) => set({ moves: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Or start from a pattern</span>
            <select
              value=""
              onChange={(e) => {
                const p = PATTERNS.find((x) => x.name === e.target.value);
                if (p) set({ moves: p.moves });
              }}
            >
              <option value="">Choose a pattern…</option>
              {PATTERNS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {draft.source === "state" && (
        <>
          <StateEditor value={draft.state} onChange={(state) => set({ state })} />
          <label className="field">
            <span>Or paste 54 stickers (URFDLB order)</span>
            <textarea
              rows={2}
              value={draft.state}
              placeholder="UUUUUUUUU RRRRRRRRR FFFFFFFFF DDDDDDDDD LLLLLLLLL BBBBBBBBB"
              spellCheck={false}
              autoCapitalize="characters"
              aria-invalid={!resolved.ok}
              aria-describedby={`${uid}-status`}
              onChange={(e) => set({ state: e.target.value })}
            />
          </label>
        </>
      )}

      <div className="scramble-summary" id={`${uid}-status`} aria-live="polite">
        {resolved.ok ? (
          <>
            <NetPreview state={resolved.scramble.state} label="Start cube, unfolded" />
            <div className="scramble-facts">
              {resolved.scramble.moves.length > 0 && (
                <p className="scramble-preview">
                  <code>{formatMoves(resolved.scramble.moves)}</code>
                </p>
              )}
              <p className="hint">
                {resolved.scramble.moves.length > 0 ? `${resolved.scramble.moves.length} moves · ` : ""}
                {distance
                  ? distance.exact
                    ? `${distance.value} moves from solved (exact)`
                    : `more than 6 moves from solved (≤ ${distance.value})`
                  : "measuring difficulty…"}
              </p>
              {solutionHint && resolved.scramble.moves.length <= 6 && (
                <details className="raw">
                  <summary>Show one solution</summary>
                  <code>{solutionHint}</code>
                </details>
              )}
            </div>
          </>
        ) : (
          <p className="error">{resolved.error}</p>
        )}
      </div>
    </fieldset>
  );
}

function SeedField({ seed, onChange }: { seed: number; onChange: (s: number) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Seed</label>
      <div className="input-row">
        <input
          id={id}
          type="number"
          min={0}
          max={2147483647}
          value={seed}
          onChange={(e) =>
            onChange(Math.max(0, Math.min(2147483647, Math.floor(Number(e.target.value) || 0))))
          }
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="New random seed"
          title="New random seed"
          onClick={() => onChange(Math.floor(Math.random() * 1_000_000))}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M13 3v3.5H9.5M3 13V9.5h3.5M12.6 6.5A5 5 0 0 0 3.8 5M3.4 9.5a5 5 0 0 0 8.8 1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const resolveDraft = (d: ScrambleDraft): ResolveResult => resolveScramble(inputOf(d));
