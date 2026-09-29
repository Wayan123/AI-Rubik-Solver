import { type Move, parseMoves } from "@rubik-arena/cube-engine";

export type ParsedResponse = { ok: true; moves: Move[] } | { ok: false; error: string };

/** Find balanced {...} substrings (string-aware) in order of appearance. */
function jsonObjects(text: string): string[] {
  const out: string[] = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          out.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Extract moves from a model answer. Uses the LAST JSON object that has a "moves" array
 * (so reasoning text or code fences before it are tolerated). Any invalid token rejects the answer.
 */
export function parseResponse(text: string, maxMoves: number): ParsedResponse {
  const candidates = jsonObjects(text)
    .map((s) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        return undefined;
      }
    })
    .filter(
      (o): o is { moves: unknown[] } =>
        typeof o === "object" && o !== null && Array.isArray((o as { moves?: unknown }).moves),
    );
  const last = candidates.at(-1);
  if (!last) return { ok: false, error: 'no JSON object with a "moves" array found' };
  const parsed = parseMoves(last.moves);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.moves.length > maxMoves) {
    return { ok: false, error: `too many moves (${parsed.moves.length} > ${maxMoves})` };
  }
  return { ok: true, moves: parsed.moves };
}
