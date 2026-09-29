import { MAX_CONCURRENCY } from "@rubik-arena/bench-core";
import { z } from "zod";

const safeId = z.string().regex(/^[\w.-]{1,64}$/);
const optionValue = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(2000)).max(20),
]);

/** Option keys that look like secrets are refused: keys must come from runner env vars (apiKeyEnv). */
const SECRET_KEY = /(^|_)(api_?key|key|token|secret|password|authorization)$/i;

export const contestantSchema = z.object({
  id: safeId,
  label: z.string().min(1).max(80),
  adapter: safeId,
  model: z
    .string()
    .regex(/^[\w./:-]{1,120}$/)
    .optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  mode: z.enum(["one-shot", "interactive"]).default("interactive"),
  maxTurns: z.number().int().min(1).max(200).default(30),
  maxMovesPerTurn: z.number().int().min(1).max(50).default(10),
  requestTimeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000),
  runTimeoutMs: z.number().int().min(1000).max(14_400_000).default(1_800_000),
  options: z
    .record(z.string().max(64), optionValue)
    .refine((o) => Object.keys(o).every((k) => k === "apiKeyEnv" || !SECRET_KEY.test(k)), {
      message: "secrets are not accepted in options; set an env var on the runner and use apiKeyEnv",
    })
    .optional(),
});

export const createRaceSchema = z
  .object({
    scramble: z
      .object({
        /** Omitted: "moves" when moves are given, otherwise "seeded" (backwards compatible). */
        source: z.enum(["seeded", "moves", "random-state", "state"]).optional(),
        seed: z
          .number()
          .int()
          .min(0)
          .max(2 ** 31 - 1)
          .default(1),
        depth: z.number().int().min(1).max(100).default(20),
        moves: z.array(z.string().max(4)).max(100).optional(),
        state: z
          .string()
          .max(200)
          .regex(/^[URFDLBurfdlb\s/|,]*$/, "state may only contain U R F D L B")
          .optional(),
      })
      .default({ seed: 1, depth: 20 }),
    concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).default(1),
    contestants: z.array(contestantSchema).min(1).max(12),
  })
  .refine((r) => new Set(r.contestants.map((c) => c.id)).size === r.contestants.length, {
    message: "contestant ids must be unique",
  });

export type CreateRaceInput = z.infer<typeof createRaceSchema>;
