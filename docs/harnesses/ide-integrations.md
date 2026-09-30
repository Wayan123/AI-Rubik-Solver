# IDE integrations

IDE discovery is file-only. Rubik Arena never starts VS Code, Cursor, Windsurf, Kiro IDE, or an extension host because even a version command can install or update supporting components.

Verified public manifest identities checked 2026-09-30:

- Continue: `Continue.continue`, source manifest in https://github.com/continuedev/continue
- Cline: `saoudrizwan.claude-dev`, source manifest in https://github.com/cline/cline
- Roo Code: `RooVeterinaryInc.roo-cline`, source manifest in https://github.com/RooCodeInc/Roo-Code
- Codex IDE: known installed identity `openai.chatgpt`; no public source manifest in `openai/codex`, therefore catalog-only

The scanner reads only bounded extension `package.json` files under approved roots. It rejects escaping symlinks and identity mismatches. It does not read IDE global storage, SQLite, settings sync, logs, conversations, tokens, `.env`, or workspace marker files.

On WSL, set `RUBIK_WINDOWS_HOME` to the active mounted Windows profile if host extensions should be detected. Do not point it at another user's profile.
