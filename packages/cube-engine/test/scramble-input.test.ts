import { describe, expect, it } from "vitest";
import {
  applyMoves,
  cubejsApply,
  DIFFICULTY_PRESETS,
  fromCubies,
  isSolvable,
  isSolved,
  normalizeStateInput,
  randomState,
  resolveScramble,
  SOLVED,
  scramble,
  solve,
  validateState,
} from "../src/index.ts";

const swap = (s: string, i: number, j: number) => {
  const a = s.split("");
  [a[i], a[j]] = [a[j]!, a[i]!];
  return a.join("");
};

describe("validateState", () => {
  it("accepts solved and scrambled states and round-trips cubies", () => {
    for (const s of [SOLVED, applyMoves(SOLVED, scramble(4, 25)), cubejsApply("R U R' U' F2 D L' B")]) {
      const v = validateState(s);
      expect(v.ok).toBe(true);
      if (v.ok) expect(fromCubies(v.cubies)).toBe(s);
    }
  });

  it("rejects wrong length, letters, centres and colour counts with readable errors", () => {
    expect(validateState("U".repeat(53))).toEqual({
      ok: false,
      errors: ["a cube state needs 54 stickers, got 53"],
    });
    const x = validateState(`X${SOLVED.slice(1)}`);
    expect(!x.ok && x.errors[0]).toContain("unknown sticker");
    const centre = validateState(swap(SOLVED, 4, 13));
    expect(!centre.ok && centre.errors.join()).toContain("centre of face U");
    const count = validateState(`R${SOLVED.slice(1)}`);
    expect(!count.ok && count.errors.join()).toContain("appears 8 times");
  });

  it("detects a twisted corner", () => {
    // Rotate the URF corner stickers in place (8, 9, 20).
    const a = SOLVED.split("");
    [a[8], a[9], a[20]] = [a[20]!, a[8]!, a[9]!];
    const v = validateState(a.join(""));
    expect(!v.ok && v.errors.join()).toContain("twisted");
  });

  it("detects a flipped edge", () => {
    const v = validateState(swap(SOLVED, 7, 19));
    expect(!v.ok && v.errors.join()).toContain("flipped");
  });

  it("detects a single swap of two edges (parity)", () => {
    // Swap UF and UR edge pieces: UF = (7,19), UR = (5,10).
    let s = swap(SOLVED, 7, 5);
    s = swap(s, 19, 10);
    const v = validateState(s);
    expect(!v.ok && v.errors.join()).toContain("parity");
  });

  it("detects impossible colour combinations", () => {
    // Put two white stickers on one edge.
    const s = swap(SOLVED, 19, 3);
    expect(isSolvable(s)).toBe(false);
  });
});

describe("randomState", () => {
  it("is deterministic, solvable, and solvable by the solver", () => {
    expect(randomState(9)).toBe(randomState(9));
    expect(randomState(9)).not.toBe(randomState(10));
    for (let seed = 0; seed < 20; seed++) {
      const s = randomState(seed);
      expect(isSolvable(s)).toBe(true);
      expect(s).not.toBe(SOLVED);
    }
    const s = randomState(3);
    expect(isSolved(applyMoves(s, solve(s)))).toBe(true);
  });
});

describe("resolveScramble", () => {
  it("seeded matches scramble()", () => {
    const r = resolveScramble({ source: "seeded", seed: 7, depth: 5 });
    expect(r.ok && r.scramble.moves).toEqual(scramble(7, 5));
    expect(r.ok && r.scramble.state).toBe(applyMoves(SOLVED, scramble(7, 5)));
  });

  it("moves: accepts user sequences and rejects bad or cancelling ones", () => {
    const r = resolveScramble({ source: "moves", moves: "R U R’ U2'" });
    expect(r.ok && r.scramble.moves).toEqual(["R", "U", "R'", "U2"]);
    expect(r.ok && r.scramble.depth).toBe(4);
    const bad = resolveScramble({ source: "moves", moves: "R x U" });
    expect(!bad.ok && bad.error).toContain('invalid move "x"');
    expect(resolveScramble({ source: "moves", moves: "R R'" })).toEqual({
      ok: false,
      error: "these moves cancel out: the cube would already be solved",
    });
    expect(resolveScramble({ source: "moves", moves: "" }).ok).toBe(false);
    expect(resolveScramble({ source: "moves", moves: Array(101).fill("R").join(" ") }).ok).toBe(false);
  });

  it("random-state gives a full-difficulty state without moves", () => {
    const r = resolveScramble({ source: "random-state", seed: 5 });
    expect(r.ok && r.scramble.state).toBe(randomState(5));
    expect(r.ok && r.scramble.moves).toEqual([]);
  });

  it("state: accepts typed facelets with separators, rejects impossible or solved", () => {
    const target = applyMoves(SOLVED, ["F", "R"]);
    const typed = target
      .match(/.{9}/g)!
      .map((f) => `${f.slice(0, 3)}/${f.slice(3, 6)}/${f.slice(6)}`)
      .join("\n")
      .toLowerCase();
    expect(normalizeStateInput(typed)).toBe(target);
    const r = resolveScramble({ source: "state", state: typed });
    expect(r.ok && r.scramble.state).toBe(target);
    expect(resolveScramble({ source: "state", state: SOLVED })).toEqual({
      ok: false,
      error: "this cube is already solved",
    });
    expect(resolveScramble({ source: "state", state: swap(SOLVED, 7, 19) }).ok).toBe(false);
  });

  it("every difficulty preset resolves", () => {
    for (const p of DIFFICULTY_PRESETS) expect(resolveScramble({ ...p.input, seed: 1 }).ok).toBe(true);
  });
});
