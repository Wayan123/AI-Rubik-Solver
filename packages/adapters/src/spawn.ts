import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const STDERR_LIMIT = 8 * 1024;
export const KILL_GRACE_MS = 5000;

export interface SpawnCliOptions {
  command: string;
  args: readonly string[];
  signal: AbortSignal;
  timeoutMs: number;
  /** Called for each complete stdout line. */
  onLine?: (line: string) => void;
  /** Maximum captured stdout bytes before the child is stopped. */
  stdoutLimitBytes?: number;
  /** Maximum captured stderr bytes before the child is stopped. */
  stderrLimitBytes?: number;
  /** Extra environment variables (merged over process.env). */
  env?: Record<string, string | undefined>;
  /** Working directory; when omitted a fresh empty temp directory is created and removed afterwards. */
  cwd?: string;
  stdin?: string;
}

export interface SpawnCliResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly result?: SpawnCliResult,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Run a CLI without a shell (argv array), in an isolated empty temp directory, streaming stdout lines.
 * On abort or timeout the child gets SIGTERM, then SIGKILL after KILL_GRACE_MS.
 */
export async function spawnCli(opts: SpawnCliOptions): Promise<SpawnCliResult> {
  const ownDir = opts.cwd ? undefined : await mkdtemp(join(tmpdir(), "rubik-arena-"));
  const cwd = opts.cwd ?? ownDir!;
  const started = performance.now();
  try {
    return await new Promise<SpawnCliResult>((resolve, reject) => {
      if (opts.signal.aborted) return reject(opts.signal.reason ?? new Error("aborted"));
      const child = spawn(opts.command, [...opts.args], {
        cwd,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...opts.env },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stdoutBytes = 0;
      let stderr = "";
      let stderrBytes = 0;
      let pending = "";
      let killTimer: NodeJS.Timeout | undefined;
      let stopReason: Error | undefined;

      const stop = (reason: Error) => {
        if (stopReason) return;
        stopReason = reason;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
        killTimer.unref();
      };
      const onAbort = () =>
        stop(opts.signal.reason instanceof Error ? opts.signal.reason : new Error("aborted"));
      opts.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(
        () => stop(new CliError(`${opts.command} exceeded ${opts.timeoutMs} ms`)),
        opts.timeoutMs,
      );

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBytes += Buffer.byteLength(chunk);
        if (opts.stdoutLimitBytes && stdoutBytes > opts.stdoutLimitBytes) {
          stop(new CliError(`${opts.command} stdout exceeded ${opts.stdoutLimitBytes} bytes`));
          return;
        }
        stdout += chunk;
        pending += chunk;
        let nl = pending.indexOf("\n");
        while (nl !== -1) {
          const line = pending.slice(0, nl).replace(/\r$/, "");
          pending = pending.slice(nl + 1);
          if (line) opts.onLine?.(line);
          nl = pending.indexOf("\n");
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const limit = opts.stderrLimitBytes ?? STDERR_LIMIT;
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > limit) {
          stop(new CliError(`${opts.command} stderr exceeded ${limit} bytes`));
          return;
        }
        stderr += chunk;
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        opts.signal.removeEventListener("abort", onAbort);
        const code = (err as NodeJS.ErrnoException).code;
        reject(new CliError(code === "ENOENT" ? `${opts.command} not found on PATH` : err.message));
      });
      child.on("close", (exitCode, sig) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        opts.signal.removeEventListener("abort", onAbort);
        if (pending.trim()) opts.onLine?.(pending.trim());
        const result = {
          exitCode,
          signal: sig,
          stdout,
          stderr,
          durationMs: Math.round(performance.now() - started),
        };
        if (stopReason) reject(stopReason);
        else resolve(result);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(opts.stdin ?? "");
    });
  } finally {
    if (ownDir) await rm(ownDir, { recursive: true, force: true });
  }
}

/** Quick `--version` style probe; resolves to the first output line or null when the command is missing. */
export async function probeVersion(
  command: string,
  args: readonly string[] = ["--version"],
): Promise<string | null> {
  try {
    const r = await spawnCli({ command, args, signal: new AbortController().signal, timeoutMs: 15_000 });
    return (r.stdout || r.stderr).trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

export function tail(text: string, n = 600): string {
  const t = text.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}
