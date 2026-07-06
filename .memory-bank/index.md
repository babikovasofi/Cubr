# Memory Bank — Cubr

> Entry point. The agent reads this first to orient. Keep it short; link out.
> This file is auto-injected at session start by .claude/hooks/inject-memory-bank.*

## Overview
<one paragraph: what this project is and who it serves — fill as it takes shape>

## Map
- [Product Overview](product-overview/README.md) — what & for whom
- [Development Conventions](steerings/development-conventions.md) — how we code
- [Testing Conventions](steerings/testing-conventions.md) — how we test
- [Self-Improvement Loop](steerings/self-improvement.md) — reflection → rules/hooks
- [Tech Details](tech-details/README.md) — stack, architecture, modules
- [Tasks](tasks/README.md) — current & planned work
- [Transcripts](transcripts/README.md) — meeting recordings → text

## Secrets
Copy `.env.example` → `.env` and fill it (HuggingFace token for transcribe, etc.).
`.env` is git-ignored.

## Bundled skills
This project ships its own copies under `.claude/skills/` — no external
marketplace needed. Utility skills: memory-bank, memory-bank-defrag,
transcribe, design-process, anti-ai-slop-writing, anti-slop-design,
mattermost, solidtime, reflect.
Dev-loop skills: plan, build, review, debug. Update them with:
`bash <startpoint>/scripts/bootstrap.sh --upgrade-skills . --force`

## Dev loop
Features go through `/plan "<feature>"` → `/build <slug>` → `/review <slug>`,
with `/debug "<error>"` when something breaks. Plans and reports land in
`swarm-report/`. Agent roster + routing table: `AGENTS.md`. A Stop hook
(test-gate) blocks "done" claims until the project's tests actually ran.

## Status
Skeleton bootstrapped. Sections are empty by design — they fill as real
decisions are made (via the memory-bank skill, importance ≥ 2 only).
