import type { CubeState } from "./cube.ts";

const face = (state: CubeState, f: number) => state.slice(f * 9, f * 9 + 9);
const row = (faceStr: string, r: number) =>
  faceStr
    .slice(r * 3, r * 3 + 3)
    .split("")
    .join(" ");

/**
 * Human/LLM-readable unfolded net. Letters are the face whose centre colour the sticker has.
 *
 *         U U U
 *         U U U
 *         U U U
 *  L L L  F F F  R R R  B B B
 *  ...
 *         D D D
 */
export function renderNet(state: CubeState): string {
  const [U, R, F, D, L, B] = [0, 1, 2, 3, 4, 5].map((i) => face(state, i)) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const pad = " ".repeat(8);
  const lines: string[] = [];
  for (let r = 0; r < 3; r++) lines.push(`${pad}${row(U, r)}`);
  for (let r = 0; r < 3; r++) lines.push(`${row(L, r)}  ${row(F, r)}  ${row(R, r)}  ${row(B, r)}`);
  for (let r = 0; r < 3; r++) lines.push(`${pad}${row(D, r)}`);
  return lines.join("\n");
}

/** Per-face listing, e.g. "U: UUU/UUU/UUU". */
export function renderFaces(state: CubeState): string {
  return ["U", "R", "F", "D", "L", "B"]
    .map((name, i) => {
      const f = face(state, i);
      return `${name}: ${f.slice(0, 3)}/${f.slice(3, 6)}/${f.slice(6, 9)}`;
    })
    .join("\n");
}
