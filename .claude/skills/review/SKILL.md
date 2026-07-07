---
name: review
description: Review a finished change against its plan. Spawns 1 reviewer subagent (plus an optional qa-smoke subagent for user-facing features), reports ship/rework with severity-tagged findings, and on ship suggests a Memory Bank update. Use AFTER /build.
---

# Skill: /review

ORCHESTRATOR. One reviewer subagent, optionally one qa-smoke subagent. Read-only —
neither of them fixes anything.

## Invocation
`/review <slug>`

## Steps
1. **Gather**: plan `swarm-report/<slug>-plan.md` + build report `swarm-report/<slug>-build.md`
   + the diff (`git diff` for staged + unstaged, or vs the branch point).
2. **Spawn 1 reviewer** (`Task`, `general-purpose`). Prompt:
   > Answer TERSE. Read `.claude/agents/reviewer.md` and follow it exactly.
   > Plan: swarm-report/<slug>-plan.md
   > Diff below:
   > <paste git diff here>

   Paste the diff INTO the prompt — the reviewer must not re-read the whole repo.
3. **Smoke-test (user-facing features only).** If the change is something a user can
   see or click (UI, endpoints, CLI commands) AND the project is runnable, spawn a
   second subagent in the same message as the reviewer:
   > Answer TERSE. Read `.claude/agents/qa-smoke.md` and follow it exactly.
   > Plan: swarm-report/<slug>-plan.md. Build report: swarm-report/<slug>-build.md.
   Pure internal refactors / library code → skip this step and say so. A qa-smoke
   `fail` or `blocked` makes the overall verdict `rework` even if the code review
   said ship.
4. **Report** the reviewer's verdict + findings verbatim, plus the qa-smoke criteria
   table if it ran.
5. If `verdict: rework` — the findings ARE the input to a `/build <slug>` retry. Do not
   auto-fix here; hand them back and let the user decide.
6. **On `ship`: Memory Bank.** Check whether the shipped feature changed durable
   project facts (new module/endpoint/contract/convention — importance ≥ 2 in the
   `memory-bank` skill's scale). If yes, propose the concise `.memory-bank/` update
   (via the bundled `memory-bank` skill format) — suggest, don't silently write. If
   nothing durable changed, say "no memory update needed".
