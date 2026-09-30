import { mkdirSync, writeFileSync } from "node:fs";
import { release, version } from "node:os";
import { dirname, join, resolve } from "node:path";
import { scanDiscovery } from "@rubik-arena/adapters";
import { initDistanceTable, initSolver } from "@rubik-arena/cube-engine";
import { generateToken } from "./auth.ts";
import { DiscoveryService } from "./discovery.ts";
import { buildServer } from "./server.ts";

const root = resolve(import.meta.dirname, "../../..");
const port = Number(process.env.RUBIK_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("RUBIK_PORT must be a valid port");
const token = process.env.RUBIK_TOKEN ?? generateToken();
const dataDir = resolve(process.env.RUBIK_DATA_DIR ?? join(root, "data", "races"));
const presetsFile = resolve(process.env.RUBIK_PRESETS ?? join(root, "config", "contestants.json"));
const webDir = resolve(process.env.RUBIK_WEB_DIR ?? join(root, "apps", "web", "dist"));
const tokenFile = resolve(process.env.RUBIK_TOKEN_FILE ?? join(root, "data", ".runner-token"));

initSolver();
initDistanceTable();

const discovery = new DiscoveryService({
  offline: process.env.RUBIK_DISCOVERY_OFFLINE === "1",
  scan: () =>
    scanDiscovery({
      platform: process.platform,
      release: release(),
      versionText: version(),
      pathValue: process.env.PATH ?? "",
      env: process.env,
      signal: new AbortController().signal,
      offline: process.env.RUBIK_DISCOVERY_OFFLINE === "1",
    }),
});
const { app, races, store } = await buildServer({
  token,
  port,
  dataDir,
  presetsFile,
  webDir,
  discovery,
  logger: false,
});
const interrupted = await store.markInterrupted();
// Loopback only: this server can spawn CLIs that act with your logins.
await app.listen({ host: "127.0.0.1", port });
void discovery.ensureStarted();

// Token file lets `npm run dev:web` (Vite proxy) pick it up; it lives in gitignored data/ with mode 0600.
mkdirSync(dirname(tokenFile), { recursive: true });
writeFileSync(tokenFile, token, { mode: 0o600 });

console.log(`\nRubik Arena runner on http://127.0.0.1:${port}`);
console.log(`Open the dashboard: http://127.0.0.1:${port}/#token=${token}`);
console.log(
  `Races are saved in ${dataDir}${interrupted ? ` (${interrupted} interrupted race(s) marked)` : ""}\n`,
);

const shutdown = async () => {
  await races.cancelAll();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
