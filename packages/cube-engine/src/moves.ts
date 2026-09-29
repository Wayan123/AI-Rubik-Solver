/** Face letters in Kociemba / cubejs facelet order. */
export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACES)[number];

export const SUFFIXES = ["", "'", "2"] as const;
export type Suffix = (typeof SUFFIXES)[number];

/** One of the 18 outer-face turns in half-turn metric. */
export type Move = `${Face}${Suffix}`;

export const ALL_MOVES: readonly Move[] = FACES.flatMap((f) => SUFFIXES.map((s) => `${f}${s}` as Move));

const MOVE_SET = new Set<string>(ALL_MOVES);

export type ParseResult = { ok: true; moves: Move[] } | { ok: false; error: string; token: string };

/** Normalize a single token: typographic prime → ', `2'` → `2`, surrounding whitespace removed. */
export function normalizeToken(token: string): string {
  return token
    .trim()
    .replace(/[’′`´]/g, "'")
    .replace(/^([URFDLB])2'$/, "$12");
}

export function isMove(token: string): token is Move {
  return MOVE_SET.has(token);
}

/** Parse a list of tokens (array or whitespace/comma separated string). Any invalid token fails the whole list. */
export function parseMoves(input: string | readonly unknown[]): ParseResult {
  const raw: unknown[] = typeof input === "string" ? input.split(/[\s,]+/).filter(Boolean) : [...input];
  const moves: Move[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, error: "move is not a string", token: String(item) };
    const token = normalizeToken(item);
    if (!isMove(token)) return { ok: false, error: `invalid move "${item}"`, token: item };
    moves.push(token);
  }
  return { ok: true, moves };
}

export function invertMove(move: Move): Move {
  const face = move[0] as Face;
  const suffix = move.slice(1) as Suffix;
  if (suffix === "2") return move;
  return `${face}${suffix === "'" ? "" : "'"}` as Move;
}

export function invertMoves(moves: readonly Move[]): Move[] {
  return [...moves].reverse().map(invertMove);
}

export function formatMoves(moves: readonly Move[]): string {
  return moves.join(" ");
}
