/**
 * Opt-in live check with a real model (costs credits/tokens):
 *   RUBIK_E2E_MODEL=kiro/claude-opus-5-5 RUBIK_E2E_THINKING=high RUBIK_E2E_DEPTH=3 npm run test:e2e
 * Defaults to Pi → kiro/claude-opus-5-5, thinking high, interactive mode, depth 3.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createContestant } from "@rubik-arena/adapters";
import { type ContestantConfig, type Mode, runRace } from "@rubik-arena/bench-core";
import { formatMoves, scramble } from "@rubik-arena/cube-engine";

const adapter = process.env.RUBIK_E2E_ADAPTER ?? "pi";
const model = process.env.RUBIK_E2E_MODEL ?? "kiro/claude-opus-5-5";
const thinking = process.env.RUBIK_E2E_THINKING ?? "high";
const depth = Number(process.env.RUBIK_E2E_DEPTH ?? 3);
const seed = Number(process.env.RUBIK_E2E_SEED ?? 2026);
const mode = (process.env.RUBIK_E2E_MODE ?? "interactive") as Mode;

const moves = scramble(seed, depth);
const contestant: ContestantConfig = {
  id: "e2e",
  label: `${adapter}:${model}:${thinking}`,
  adapter,
  model,
  thinking,
  mode,
  maxTurns: Number(process.env.RUBIK_E2E_TURNS ?? 8),
  maxMovesPerTurn: 10,
  requestTimeoutMs: 600_000,
  runTimeoutMs: 1_800_000,
};

console.log(`Scramble (seed ${seed}, depth ${depth}): ${formatMoves(moves)}`);
console.log(`Contestant: ${contestant.label} (${mode})`);
const t0 = performance.now();
const [result] = await runRace({
  race: {
    id: `e2e-${Date.now()}`,
    createdAt: new Date().toISOString(),
    scramble: { seed, depth, moves },
    concurrency: 1,
    contestants: [contestant],
  },
  createContestant,
  signal: new AbortController().signal,
  emit: (e) => {
    const s = (performance.now() - t0) / 1000;
    if (e.type === "turn_started") console.log(`[${s.toFixed(1)}s] turn ${e.turn} …`);
    if (e.type === "first_token") console.log(`[${s.toFixed(1)}s]   first token after ${e.ttftMs} ms`);
    if (e.type === "turn_finished") {
      const r = e.record;
      console.log(
        `[${s.toFixed(1)}s]   ${r.valid ? "moves" : "INVALID"} ${r.valid ? formatMoves(r.moves) : r.error} → distance ${r.distanceAfter.value}${r.distanceAfter.exact ? "" : "≤"} (${r.latencyMs} ms)`,
      );
    }
  },
});
if (!result) throw new Error("no result");

console.log(
  `\n${result.status.toUpperCase()} in ${(result.wallMs / 1000).toFixed(1)} s · ${result.turns.length} turn(s) · ${result.movesApplied.length} moves · ` +
    `progress ${(result.progress * 100).toFixed(0)}% · tokens ${result.tokensIn}/${result.tokensOut} · model ${result.reportedModel ?? "?"}` +
    (result.cost.length
      ? ` · cost ${result.cost.map((c) => `${c.value.toFixed(3)} ${c.unit}`).join(", ")}`
      : "") +
    (result.error ? ` · error: ${result.error}` : ""),
);

const outDir = resolve(import.meta.dirname, "..", "data", "e2e");
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));
console.log(`Saved ${file}`);
process.exit(result.status === "error" ? 1 : 0);
