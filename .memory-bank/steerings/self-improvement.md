# Self-Improvement Loop

> How the agent learns from its own mistakes. This is a *practice*, not project
> facts — keep the recipe, add concrete rules over time.

## The reflection recipe
Automated: run the bundled **/reflect** skill (`.claude/skills/reflect`) — it
scans recent sessions for recurring friction and proposes a hook / skill /
steering rule, then logs the accepted fix here.

Manual version — at the end of a working session where the agent kept making
the same mistake, ask it to reflect:

> "Today we repeatedly hit <problem>. Analyze my recent sessions in this
>  project, find where you went wrong most often, and where you could check
>  yourself instead of asking me. Then, if it can become a **hook** or a
>  **skill**, propose it. Also research best practices online — someone has
>  probably solved this already."

## Outcomes to capture here
- Recurring problems → converted to rules / hooks / skills.
- Example: oversized files → the bundled PostToolUse size hook flags files over
  the agreed line limit after each edit; decompose when triggered.

## Where past sessions live
Claude Code stores session history under its config dir (e.g. `~/.claude/...`,
project-keyed). The agent can read its own prior sessions to spot patterns.

<add concrete, learned rules below as they emerge>
