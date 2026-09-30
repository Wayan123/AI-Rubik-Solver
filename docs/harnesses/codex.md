# OpenAI Codex

Official project: https://github.com/openai/codex and https://developers.openai.com/codex. Evidence checked 2026-09-30.

Rubik Arena detects the `codex` CLI and its version. Direct Codex execution is catalog-only: Codex does not expose an audited `codex --list-models` command used by this project, and Rubik Arena does not invent one. Codex/ChatGPT models listed by Pi remain verified Pi routes such as `openai-codex/<model>`.

The known Codex IDE extension manifest ID `openai.chatgpt` may be detected file-only. Its source manifest is not published in the Codex repository, so detection verifies the locally installed manifest identity but grants no execution capability.

Release metadata is read only from the allowlisted official `openai/codex` GitHub Releases endpoint. Rubik Arena never installs the release. Permission-bypass and full-auto modes are forbidden for any future adapter.
