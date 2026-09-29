import { describe, expect, it } from "vitest";
import {
  ALL_MOVES,
  applyMoves,
  cubejsApply,
  distanceToSolved,
  EXACT_LIMIT,
  exactDistance,
  formatMoves,
  invertMoves,
  isSolved,
  isWellFormed,
  kociembaDistance,
  type Move,
  mulberry32,
  parseMoves,
  renderNet,
  SOLVED,
  scramble,
  solve,
} from "../src/index.ts";

const m = (s: string) => {
  const r = parseMoves(s);
  if (!r.ok) throw new Error(r.error);
  return r.moves;
};

describe("move tables", () => {
  it.each(ALL_MOVES)("%s applied four times is identity", (move) => {
    expect(applyMoves(SOLVED, [move, move, move, move])).toBe(SOLVED);
  });

  it("sexy move six times is identity", () => {
    const six = Array.from({ length: 6 }, () => m("R U R' U'")).flat();
    expect(applyMoves(SOLVED, six)).toBe(SOLVED);
  });

  it("matches cubejs for every single move", () => {
    for (const move of ALL_MOVES) expect(applyMoves(SOLVED, [move])).toBe(cubejsApply(move));
  });

  it("matches cubejs for 200 random sequences", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const seq: Move[] = Array.from({ length: 25 }, () => ALL_MOVES[Math.floor(rand() * 18)]!);
      expect(applyMoves(SOLVED, seq)).toBe(cubejsApply(formatMoves(seq)));
    }
  });

  it("inverse undoes a sequence", () => {
    const seq = scramble(7, 30);
    expect(applyMoves(applyMoves(SOLVED, seq), invertMoves(seq))).toBe(SOLVED);
  });

  it("keeps the state well formed", () => {
    expect(isWellFormed(applyMoves(SOLVED, scramble(1, 40)))).toBe(true);
    expect(isWellFormed("X".repeat(54))).toBe(false);
  });
});

describe("parseMoves", () => {
  it("normalizes typographic primes and 2'", () => {
    expect(m("R’ U2' F")).toEqual(["R'", "U2", "F"]);
  });
  it("accepts arrays and commas", () => {
    expect(parseMoves(["R", "U'"])).toEqual({ ok: true, moves: ["R", "U'"] });
    expect(m("R,U,F2")).toEqual(["R", "U", "F2"]);
  });
  it.each(["x", "M", "Rw", "r", "R3", "RR", "2R", "U''"])("rejects %s", (bad) => {
    const r = parseMoves(`R ${bad} U`);
    expect(r.ok).toBe(false);
  });
  it("rejects non-string items", () => {
    expect(parseMoves(["R", 3]).ok).toBe(false);
  });
});

describe("scramble", () => {
  it("is deterministic per seed", () => {
    expect(scramble(123, 20)).toEqual(scramble(123, 20));
    expect(scramble(123, 20)).not.toEqual(scramble(124, 20));
  });
  it("never repeats a face back-to-back or three turns on one axis", () => {
    const axis = (x: string) => ({ U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 })[x[0] as "U"];
    for (let seed = 0; seed < 50; seed++) {
      const s = scramble(seed, 30);
      expect(s).toHaveLength(30);
      for (let i = 1; i < s.length; i++) expect(s[i]![0]).not.toBe(s[i - 1]![0]);
      for (let i = 2; i < s.length; i++) {
        expect(axis(s[i]!) === axis(s[i - 1]!) && axis(s[i]!) === axis(s[i - 2]!)).toBe(false);
      }
    }
  });
  it("rejects invalid depth", () => {
    expect(() => scramble(1, -1)).toThrow();
    expect(() => scramble(1, 1.5)).toThrow();
  });
});

describe("solver", () => {
  it("solves a random scramble", () => {
    const state = applyMoves(SOLVED, scramble(99, 25));
    const solution = solve(state);
    expect(solution.length).toBeGreaterThan(0);
    expect(solution.length).toBeLessThanOrEqual(24);
    expect(isSolved(applyMoves(state, solution))).toBe(true);
  });
  it("two-phase distance is 0 for solved and an upper bound otherwise", () => {
    expect(kociembaDistance(SOLVED)).toBe(0);
    expect(kociembaDistance(applyMoves(SOLVED, ["R"]))).toBeGreaterThanOrEqual(1);
  });
});

describe("distanceToSolved", () => {
  it.each([
    ["", 0],
    ["R", 1],
    ["R U", 2],
    ["R U R' U'", 4],
    ["R U F L D B", 6],
  ])("%s → exact %i", (seq, d) => {
    expect(distanceToSolved(applyMoves(SOLVED, seq ? m(seq) : []))).toEqual({ value: d, exact: true });
  });
  it("R R' cancels to 0 and R2 R2 too", () => {
    expect(exactDistance(applyMoves(SOLVED, m("R R'")))).toBe(0);
    expect(exactDistance(applyMoves(SOLVED, m("R2 R2 U")))).toBe(1);
  });
  it("never exceeds scramble length for short scrambles", () => {
    for (let seed = 0; seed < 5; seed++) {
      const d = distanceToSolved(applyMoves(SOLVED, scramble(seed, 7)));
      expect(d.exact).toBe(true);
      expect(d.value).toBeLessThanOrEqual(7);
    }
  });
  it("falls back to a bound above EXACT_LIMIT for deep scrambles", () => {
    const d = distanceToSolved(applyMoves(SOLVED, scramble(3, 25)));
    expect(d.exact).toBe(false);
    expect(d.value).toBeGreaterThan(EXACT_LIMIT);
  });
  it("fast mode is exact up to 6 and bounded above 6", () => {
    expect(distanceToSolved(applyMoves(SOLVED, m("R U F L D B")), { mode: "fast" })).toEqual({
      value: 6,
      exact: true,
    });
    const far = distanceToSolved(applyMoves(SOLVED, scramble(3, 25)), { mode: "fast" });
    expect(far.exact).toBe(false);
    expect(far.value).toBeGreaterThan(6);
  });
});

describe("renderNet", () => {
  it("renders the solved cube net", () => {
    expect(renderNet(SOLVED)).toMatchInlineSnapshot(`
      "        U U U
              U U U
              U U U
      L L L  F F F  R R R  B B B
      L L L  F F F  R R R  B B B
      L L L  F F F  R R R  B B B
              D D D
              D D D
              D D D"
    `);
  });
});
