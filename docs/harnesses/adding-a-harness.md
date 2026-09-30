# Adding a harness safely

A GitHub repository URL is documentation, not executable plugin input. Rubik Arena never downloads connector code at runtime.

## Catalog-only detector gate

1. Record official repository, documentation, license, artifact, and evidence date.
2. Add a source-controlled definition with static binary names, extension IDs, paths, and URLs.
3. Detect only bounded installation/version evidence. Do not read credential stores, `.env`, histories, global-state databases, or arbitrary config.
4. Use static argv with `shell: false`, timeout, abort, empty temporary cwd, and bounded stdout/stderr.
5. Add malformed, timeout, missing, path traversal, symlink, output flood, and secret-redaction tests.
6. Document what is observed and what remains unverified.

## Verified-runnable gate

In addition to the above:

1. Prove a stable non-interactive structured-output contract.
2. Disable tools, MCP, skills, extensions, context files, sessions, and workspace access wherever supported.
3. Never use `--yolo`, `--trust-all-tools`, `--dangerously-*`, `bypassPermissions`, `--yes-always`, or equivalent blanket approval.
4. Capture and sanitize a real fixture.
5. Test exact safe argv, attempted tool use, model mismatch, provider/auth failure, malformed output, timeout, cancellation, and secret redaction.
6. Perform a harmless manual filesystem side-effect probe and record the result.
7. Add usage, authentication, cost, limitation, and forbidden-mode documentation.
8. Obtain security review before changing support level.

A harness that cannot disable tools remains catalog-only unless a separate container or micro-VM design is approved.
