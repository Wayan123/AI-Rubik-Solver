import { type CubeState, formatMoves, type Move, renderFaces, renderNet } from "@rubik-arena/cube-engine";
import type { Mode } from "./types.ts";

/** Bump when prompts or the output protocol change; stored in every result. */
export const PROMPT_VERSION = "v1";

const NOTATION = `Notation (Singmaster, half-turn metric): U D L R F B are clockwise quarter turns of the Up, Down,
Left, Right, Front, Back faces as seen when looking directly at that face. A prime (') is counter-clockwise,
2 is a half turn. Only these 18 moves are allowed: U U' U2 D D' D2 L L' L2 R R' R2 F F' F2 B B' B2.
No cube rotations (x y z), slice (M E S) or wide (r, Rw) moves.`;

const STATE_FORMAT = `State format: each sticker is written as the letter of the face whose CENTRE has the same colour
(U, R, F, D, L, B). Faces are shown in the standard unfolded net; the centre sticker of each face never moves.
Face rows are read as you look at that face from outside with U on top (for U: B side on top; for D: F side on top).`;

export function systemPrompt(mode: Mode, maxMovesPerTurn: number): string {
  const task =
    mode === "one-shot"
      ? "Return the COMPLETE move sequence that takes the given cube to the solved state in one answer."
      : `Return the NEXT 1 to ${maxMovesPerTurn} moves. You will then receive the resulting state and can continue.`;
  return `You are competing in a Rubik's cube (3x3x3) solving benchmark.
${NOTATION}
${STATE_FORMAT}
${task}
Answer with ONLY a JSON object of the form {"moves": ["R", "U'", "F2"]} and nothing else.
The harness applies your moves exactly; invalid tokens make the whole answer invalid.`;
}

export interface TurnContext {
  state: CubeState;
  turn: number;
  maxTurns: number;
  history: readonly Move[];
  feedback?: string;
}

export function userPrompt(mode: Mode, ctx: TurnContext): string {
  const parts = [
    "Current cube state (net):",
    renderNet(ctx.state),
    "",
    "Same state, per face (rows separated by /):",
    renderFaces(ctx.state),
    "",
    `Facelet string (URFDLB order): ${ctx.state}`,
  ];
  if (mode === "interactive") {
    parts.push("", `Turn ${ctx.turn} of ${ctx.maxTurns}.`);
    parts.push(
      `Moves applied so far (${ctx.history.length}): ${ctx.history.length ? formatMoves(ctx.history) : "none"}`,
    );
    if (ctx.feedback) parts.push(`Feedback on your previous answer: ${ctx.feedback}`);
  }
  parts.push("", 'Respond with only {"moves": [...]}.');
  return parts.join("\n");
}
