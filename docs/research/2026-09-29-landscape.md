# Research: LLMs solving the 3×3 Rubik's Cube (2026-09-29)

Status labels: **observed** (checked by command or primary source), **inferred**, **hypothesis**.

## Literature (observed via arXiv API, `export.arxiv.org/api/query`)

| Work | ID | Relevance |
|---|---|---|
| CubeBench: Diagnosing Interactive, Long-Horizon Spatial Reasoning Under Partial Observations (Gao et al., 2025) | arXiv:2512.23328v3 | Three tiers (full symbolic → full visual → partial visual). Reports a **uniform 0.00% pass rate on long-horizon tasks** for leading LLMs; proposes external solver tools as a diagnostic. |
| Cube Bench: A Benchmark for Spatial Visual Reasoning in MLLMs (Anand & Shareghi, 2025) | arXiv:2512.20595v1, code `github.com/dana-23/cube-bench` | Shared scrambled states, identical prompts/parsers, **single distance-to-solved metric**, results as a function of scramble depth; models rarely recover once a trajectory diverges. |
| CubeRobot (Wang et al., 2025) | arXiv:2503.19281v1 | Embodied VLM; task tiers by move count (1, 9–12, 19–31). |

### Design consequences (inferred)

1. A binary solved/unsolved score will read ~0 for most models on deep scrambles. The dashboard must show
   **progress**: distance-to-solved over time, best distance reached, and results per scramble depth.
2. Every model must see the **same seeded scrambles, same prompt, same parser** (Cube Bench protocol).
3. Two modes are needed: **one-shot** (full plan, tests mental simulation) and **interactive** (the state is
   re-sent every turn, tests move selection with feedback), mirroring CubeBench tiers 1 and Cube Bench skill (iv).
4. The harness, never the model, applies and verifies moves.

## Reference solver (observed)

`cubejs@1.3.2` (MIT, Kociemba two-phase). Local probe: solver init 1 364 ms, a random state solved in
20 moves in 43 ms. It is used for scrambles-from-state, the exact **upper bound of distance-to-solved**
(two-phase length, not guaranteed optimal; labelled "Kociemba distance"), and as a baseline contestant.

## Login-based CLI access (observed on this machine, 2026-09-29)

| CLI | Version | Headless invocation | Notes |
|---|---|---|---|
| `pi` | 0.87.1 | `pi -p --mode json --no-session --no-tools --no-skills --no-context-files --no-extensions -e <provider-pkg> --model kiro/claude-opus-5-5 --thinking high --system-prompt …` | JSONL events; `turn_end.message.usage` has input/output tokens; model echoed as `claude-opus-5-5`. Probe: 3.1–5.3 s wall. |
| `kiro-cli` | 2.24.1 | `kiro-cli chat --agent-engine v3 --no-interactive --model claude-opus-5.5 --trust-tools= --output-format stream-json` | Engine v2 prints `failed to set model … Method not found` and silently uses `auto`; **v3 applies the model**. `--effort high` was reported back as `effortLevel: medium` (unverified effort). Reports credits (`promptTurnSummaries`). |
| `codex` | 0.157.1 | `codex exec --json --ephemeral --skip-git-repo-check -s read-only -m <model>` | not yet probed end-to-end |
| `claude` | 2.1.63 | `claude -p --output-format json --tools "" --no-session-persistence --model <m> --effort <e>` | not yet probed |
| `gemini` | 0.43.0 | `gemini -p <prompt> -o json --approval-mode plan -m <m>` | not yet probed |
| `hermes` | 0.21.3 | `hermes -z <prompt> -m <m> --ignore-rules --usage-file <f>` | not yet probed |
| `opencode` | 1.15.3 | `opencode run --format json -m provider/model` | not yet probed |

Kiro models listed by `pi --list-models kiro` include `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5`,
`gpt-5-6-sol|terra|luna`, `deepseek-3-2`, `glm-5`, `minimax-m2-5`. Model names such as "GPT Astra", "Jev",
"Laya" were **not found** in these lists; the app therefore discovers model IDs from each CLI instead of
hard-coding them.

## Security notes (observed flags)

Agent CLIs can execute tools. Adapters must disable tools (`--no-tools`, `--tools ""`, `--trust-tools=`,
`-s read-only`, `--approval-mode plan`), run in an empty temporary working directory, pass prompts as argv
(no shell), and never use `--yolo`, `--dangerously-*`, or `--trust-all-tools`.
