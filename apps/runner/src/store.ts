import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RaceConfig, RaceEvent, RunResult } from "@rubik-arena/bench-core";
import type { CubeState } from "@rubik-arena/cube-engine";

export type RaceStatus = "running" | "finished" | "cancelled" | "error" | "interrupted";

export interface RaceRecord {
  race: RaceConfig;
  initialState: CubeState;
  status: RaceStatus;
  finishedAt?: string;
  error?: string;
  /** Full event log (enables replay). */
  events: RaceEvent[];
  results: RunResult[];
}

export interface RaceSummary {
  id: string;
  createdAt: string;
  status: RaceStatus;
  scrambleDepth: number;
  scrambleSource: string;
  /** Exact or upper-bound distance of the start state, from the first result when available. */
  startDistance?: { value: number; exact: boolean };
  contestants: Array<{ label: string; status: string; wallMs: number; progress: number; solved: boolean }>;
}

const ID = /^[\w.-]{1,120}$/;

/** One JSON file per race under `dir`. Writes are atomic (tmp + rename). */
export class RaceStore {
  constructor(readonly dir: string) {}

  private path(id: string): string {
    if (!ID.test(id)) throw new Error("invalid race id");
    return join(this.dir, `${id}.json`);
  }

  async save(record: RaceRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.path(record.race.id);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(record));
    await rename(tmp, file);
  }

  async load(id: string): Promise<RaceRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8")) as RaceRecord;
    } catch {
      return undefined;
    }
  }

  async list(limit = 100): Promise<RaceSummary[]> {
    let files: string[];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    files.sort().reverse();
    const out: RaceSummary[] = [];
    for (const f of files.slice(0, limit)) {
      const r = await this.load(f.slice(0, -5));
      if (!r) continue;
      out.push({
        id: r.race.id,
        createdAt: r.race.createdAt,
        status: r.status,
        scrambleDepth: r.race.scramble.moves.length,
        scrambleSource: r.race.scramble.source ?? (r.race.scramble.moves.length ? "moves" : "seeded"),
        startDistance: r.results[0]?.initialDistance,
        contestants: r.race.contestants.map((c) => {
          const res = r.results.find((x) => x.contestantId === c.id);
          return {
            label: c.label,
            status: res?.status ?? "pending",
            wallMs: res?.wallMs ?? 0,
            progress: res?.progress ?? 0,
            solved: res?.solved ?? false,
          };
        }),
      });
    }
    return out;
  }

  /** Mark races left "running" by a crashed process as interrupted. */
  async markInterrupted(): Promise<number> {
    let n = 0;
    let files: string[] = [];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return 0;
    }
    for (const f of files) {
      const r = await this.load(f.slice(0, -5));
      if (r?.status === "running") {
        r.status = "interrupted";
        await this.save(r);
        n++;
      }
    }
    return n;
  }
}
