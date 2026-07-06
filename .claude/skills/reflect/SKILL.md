---
name: reflect
description: >
  End-of-day self-improvement ritual. Reads recent Claude Code session
  transcripts for THIS project, finds where the user repeatedly corrected or
  scolded the agent and where the same mistake recurred, distills the top
  friction points, and proposes concrete countermeasures — a hook, a skill, a
  steering rule, or an agent tweak. Accepted outcomes are implemented and
  recorded in `.memory-bank/steerings/self-improvement.md`. Use at the end of
  a working session or when the user says "порефлексируй", "reflect on
  today", "что сегодня шло плохо", "что можно улучшить в процессе", "/reflect".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
argument-hint: "[days]  (optional: how many days back to scan, default 1)"
---

# Skill: /reflect

Turn today's friction into tomorrow's harness. You analyze your own recent sessions in
this project, find the patterns the user had to fight, and convert them into durable
fixes. One honest finding beats five generic ones.

## Where sessions live

Claude Code stores transcripts under `~/.claude/projects/<project-slug>/` as `.jsonl`
files — the slug is the project's absolute path with every non-alphanumeric character
replaced by `-`. Locate the right directory defensively:

```bash
# Newest project dirs first; the slug for non-ASCII paths degenerates to dashes,
# so VERIFY by the cwd recorded inside the transcript, not by the dir name.
ls -dt ~/.claude/projects/*/ | head -10
grep -m1 -o '"cwd":"[^"]*"' <dir>/<newest>.jsonl
```

Pick the directory whose transcripts record `cwd` = this project. Then take the
sessions modified in the last N days (default 1):

```bash
find <dir> -name '*.jsonl' -mtime -<N> -print
```

## What to extract (keep it cheap)

Transcripts are large — do NOT read them whole. Pull only the user's own words and
error signals, e.g.:

```bash
jq -r 'select(.type=="user") | .message.content
       | if type=="string" then . else (.[]? | select(.type=="text") | .text) end' \
  session.jsonl 2>/dev/null | head -200
```

(Schema varies between versions — if `jq` extraction comes back empty, fall back to
`grep -o` for text fields. Skip binary/huge lines.)

Look for:
- **Corrections** — "не так", "опять", "я же говорила", "no, I meant", the same
  instruction given twice in different sessions.
- **Reverts** — the user asking to undo or redo something you produced.
- **Repeated friction** — the same tool error, the same failing check, the same style
  complaint across sessions.
- **Manual routine** — a multi-step thing the user asked for more than once verbatim.

## Classify each finding → the right countermeasure

| Pattern | Fix |
|---------|-----|
| Deterministic check, known trigger moment ("after every edit", "before done") | **Hook** (PostToolUse / Stop) — script it, wire into `.claude/settings.json` |
| Recurring multi-step procedure with judgment involved | **Skill** in `.claude/skills/` |
| Behavior/style preference ("never do X", "always Y") | **Steering rule** — one line in `.memory-bank/steerings/self-improvement.md` (or the relevant conventions file) |
| One exec agent keeps making the same mistake | **Agent tweak** — a rule line in that `.claude/agents/*.md` |

When unsure which bucket — prefer the cheapest (steering rule) and say so.

## Steps

1. Locate the project's session dir (above). No sessions found → say so and stop;
   do not invent findings.
2. Scan the last N days of sessions. Cluster the signals into at most **3 themes**,
   each with real quotes/evidence (session file + the user's words).
3. For each theme propose ONE countermeasure from the table, with a one-line cost
   estimate ("5-line PostToolUse hook", "one rule in conventions").
4. **Ask the user** which proposals to adopt (AskUserQuestion, multiSelect). Zero
   findings of substance → report "nothing recurring today" honestly; a quiet day is
   a valid outcome.
5. Implement the accepted ones now: write the hook/skill/rule, wire settings if
   needed, test a hook by feeding it sample stdin.
6. Record in `.memory-bank/steerings/self-improvement.md`: date, the friction, the
   countermeasure installed. This file is the log of learned rules — append, keep
   each entry to 2–3 lines.

## Anti-patterns

- Inventing friction to look useful. No recurring pattern → no proposal.
- Proposing an agent/skill for what a one-line rule fixes.
- Reading whole transcripts into context (they can be megabytes) — extract, don't read.
- Turning a one-off mistake into a permanent rule. Twice+ = pattern; once = noise.
- Blocking hooks for style preferences — warn-only unless the user asks to block.
