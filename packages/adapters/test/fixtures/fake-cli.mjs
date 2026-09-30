#!/usr/bin/env node
// Fake CLI used by adapter tests. Behaviour is selected by FAKE_MODE; argv is echoed to FAKE_ARGS_FILE.
import { readFileSync, writeFileSync } from "node:fs";

const mode = process.env.FAKE_MODE ?? "echo";
if (process.env.FAKE_ARGS_FILE) {
  writeFileSync(
    process.env.FAKE_ARGS_FILE,
    JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }),
  );
}

switch (mode) {
  case "fixture":
    process.stdout.write(readFileSync(process.env.FAKE_FIXTURE, "utf8"));
    break;
  case "lines":
    process.stdout.write("one\ntwo\n");
    setTimeout(() => process.stdout.write("three"), 20);
    break;
  case "flood":
    process.stdout.write("x".repeat(4096));
    break;
  case "stderr-flood":
    process.stderr.write("é".repeat(4096));
    break;
  case "fail":
    process.stderr.write("Error: not logged in. Run login first.\n");
    process.exit(3);
    break;
  case "hang":
    process.on("SIGTERM", () => {
      process.stdout.write("got-sigterm\n");
      process.exit(143);
    });
    setInterval(() => {}, 1000);
    break;
  default:
    process.stdout.write(`${JSON.stringify(process.argv.slice(2))}\n`);
}
