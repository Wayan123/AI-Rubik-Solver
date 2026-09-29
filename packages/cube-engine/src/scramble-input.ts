import { applyMoves, type CubeState, SOLVED } from "./cube.ts";
import { randomState, validateState } from "./cubies.ts";
import { type Move, parseMoves } from "./moves.ts";
import { scramble } from "./scramble.ts";

/**
 * Where the starting cube comes from.
 * - `seeded`: random face turns from a seed and a depth (reproducible).
 * - `moves`: the user's own move sequence (e.g. an official WCA scramble or a hand-made pattern).
 * - `random-state`: uniformly random reachable state from a seed (full difficulty, ~18–20 moves optimal).
 * - `state`: the user's own 54-sticker facelet string (e.g. copied from a physical cube).
 */
export type ScrambleSource = "seeded" | "moves" | "random-state" | "state";

export interface ScrambleInput {
  source: ScrambleSource;
  seed?: number;
  depth?: number;
  /** For `moves`: tokens or a whitespace-separated string. */
  moves?: readonly string[] | string;
  /** For `state`: 54 characters in URFDLB order. */
  state?: string;
}

export interface ResolvedScramble {
  source: ScrambleSource;
  seed?: number;
  /** Number of scramble moves when the state was produced by moves; undefined for state-based sources. */
  depth?: number;
  /** Moves from solved to the start state (empty for state-based sources). */
  moves: Move[];
  state: CubeState;
}

export type ResolveResult = { ok: true; scramble: ResolvedScramble } | { ok: false; error: string };

export const MAX_SCRAMBLE_MOVES = 100;

/** Normalize a typed facelet string: strip whitespace, "/" and "|", uppercase. */
export function normalizeStateInput(text: string): string {
  return text.replace(/[\s/|,]+/g, "").toUpperCase();
}

export function resolveScramble(input: ScrambleInput): ResolveResult {
  switch (input.source) {
    case "seeded": {
      const seed = input.seed ?? 1;
      const depth = input.depth ?? 20;
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_SCRAMBLE_MOVES) {
        return { ok: false, error: `depth must be 1–${MAX_SCRAMBLE_MOVES}` };
      }
      const moves = scramble(seed, depth);
      return {
        ok: true,
        scramble: { source: "seeded", seed, depth, moves, state: applyMoves(SOLVED, moves) },
      };
    }
    case "moves": {
      const parsed = parseMoves(input.moves ?? []);
      if (!parsed.ok) return { ok: false, error: `${parsed.error}. Use U D L R F B with ' or 2.` };
      if (parsed.moves.length === 0) return { ok: false, error: "enter at least one move" };
      if (parsed.moves.length > MAX_SCRAMBLE_MOVES) {
        return { ok: false, error: `at most ${MAX_SCRAMBLE_MOVES} moves` };
      }
      const state = applyMoves(SOLVED, parsed.moves);
      if (state === SOLVED)
        return { ok: false, error: "these moves cancel out: the cube would already be solved" };
      return {
        ok: true,
        scramble: { source: "moves", depth: parsed.moves.length, moves: parsed.moves, state },
      };
    }
    case "random-state": {
      const seed = input.seed ?? 1;
      return { ok: true, scramble: { source: "random-state", seed, moves: [], state: randomState(seed) } };
    }
    case "state": {
      const state = normalizeStateInput(input.state ?? "");
      const v = validateState(state);
      if (!v.ok) return { ok: false, error: v.errors.join("; ") };
      if (state === SOLVED) return { ok: false, error: "this cube is already solved" };
      return { ok: true, scramble: { source: "state", moves: [], state } };
    }
  }
}

export interface DifficultyPreset {
  id: string;
  label: string;
  description: string;
  input: Omit<ScrambleInput, "seed">;
}

/** Difficulty presets. Depth = random face turns; "random-state" = full difficulty. */
export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  {
    id: "warmup",
    label: "Warm-up (1–2)",
    description: "One or two turns from solved.",
    input: { source: "seeded", depth: 2 },
  },
  {
    id: "easy",
    label: "Easy (3)",
    description: "Three random turns.",
    input: { source: "seeded", depth: 3 },
  },
  {
    id: "medium",
    label: "Medium (5)",
    description: "Five random turns; already hard for most models.",
    input: { source: "seeded", depth: 5 },
  },
  {
    id: "hard",
    label: "Hard (8)",
    description: "Eight random turns.",
    input: { source: "seeded", depth: 8 },
  },
  {
    id: "expert",
    label: "Expert (12)",
    description: "Twelve random turns.",
    input: { source: "seeded", depth: 12 },
  },
  {
    id: "master",
    label: "Master (20)",
    description: "Twenty random turns, close to fully scrambled.",
    input: { source: "seeded", depth: 20 },
  },
  {
    id: "wca",
    label: "Full random (WCA-style)",
    description: "Uniformly random reachable state, like official competition scrambles.",
    input: { source: "random-state" },
  },
];
