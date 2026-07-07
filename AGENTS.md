# Mini Dev-Loop Harness

A drop-in `.claude/` layout that gives any Claude Code / Codex project a deterministic
development loop: **/plan → /build → /review → /debug**.

It is *files*, not a CLI. There is no `harness do "build X"`. After you copy `.claude/`
into your project, you use your normal agent CLI; the harness activates through skills
and agents.

## The loop

1. `/plan "<feature>"` — design before code. planner + skeptic read your Memory Bank,
   argue, and write a plan to `swarm-report/`.
2. `/build <slug>` — the executing agents whose file scope the feature touches implement
   the approved plan and run the tests. Multi-layer feature → several exec agents in
   parallel.
3. `/review <slug>` — the reviewer checks the diff against the plan and reports ship/rework.
4. `/debug "<error>"` — when a test fails, a build is blocked, or something breaks: the
   debugger reproduces, ladders hypotheses, isolates on evidence, applies the minimal fix.

Feature broke on test or review said `rework` → `/debug` → back to `/build`. The **Stop
test-gate hook** blocks "done" until the project's tests actually run and their output is
cited — testing after every feature is enforced, not optional.

## Agents

### Consilium (design + review + debug — diagnose, don't bulk-edit)
| Role     | Agent                        | Used by   |
|----------|------------------------------|-----------|
| planner  | `.claude/agents/planner.md`  | `/plan`   |
| skeptic  | `.claude/agents/skeptic.md`  | `/plan`   |
| reviewer | `.claude/agents/reviewer.md` | `/review` |
| qa-smoke | `.claude/agents/qa-smoke.md` | `/review` (user-facing features — walks acceptance criteria as a user) |
| debugger | `.claude/agents/debugger.md` | `/debug`  |

### Executing (write code — matched by file scope)
`/build` maps each plan task's affected files to an exec agent. A feature that touches
several layers runs several exec agents in parallel.

**Match order: stack-specific first, generic fallback last.** The specific agents carry
2026 best-practice rules for their stack; the generic ones catch anything not covered.
Confirm the actual stack from the repo (`package.json`, `pubspec.yaml`, `pyproject.toml`,
`*.xcodeproj`, `build.gradle.kts`, `*.tf`) before picking.

**Stack-specific:**
| Agent                              | Scope (signal files / globs)                              |
|------------------------------------|-----------------------------------------------------------|
| `.claude/agents/react-ts.md`       | `**/*.{tsx,jsx}` + React in `package.json`                |
| `.claude/agents/node-ts.md`        | server `**/*.ts` + `package.json` (Fastify/Nest/Hono, no React) |
| `.claude/agents/python-fastapi.md` | `**/*.py`, `pyproject.toml` (FastAPI)                     |
| `.claude/agents/flutter.md`        | `pubspec.yaml`, `**/*.dart`                               |
| `.claude/agents/ios.md`            | `**/*.swift`, `*.xcodeproj`, `Package.swift`             |
| `.claude/agents/android.md`        | `**/*.kt`, `build.gradle.kts`, `libs.versions.toml`      |
| `.claude/agents/terraform-yandex.md` | `**/*.tf`, `.terraform.lock.hcl`                        |

**Generic fallback (stacks not covered above — e.g. Vue/Svelte, Go/Ruby, plain infra):**
| Agent                        | Scope                                                              |
|------------------------------|-------------------------------------------------------------------|
| `.claude/agents/frontend.md` | `frontend/**`, `web/**`, `ui/**`, `**/*.{vue,svelte,css,scss}`     |
| `.claude/agents/backend.md`  | `backend/**`, `api/**`, `server/**`, `**/*.{go,rb,java}`           |
| `.claude/agents/devops.md`   | `Dockerfile`, `docker-compose*`, `.github/**`, `k8s/**`, `Makefile` |
| `.claude/agents/mobile.md`   | other mobile not matched above                                    |

**Role-specific (matched by the NATURE of the task, not the file glob):**
| Agent                        | Owns                                                               |
|------------------------------|--------------------------------------------------------------------|
| `.claude/agents/designer.md` | visual-only work: layout, styling, design tokens, standalone HTML artifacts (landings, prototypes, slides, mockups). Runs on `design-process` + `anti-slop-design`. Component/business logic stays with `frontend`/`react-ts` — a task that changes both look AND behavior goes to the stack agent, with `designer` only when the plan splits the visual part out. |

No scope matches → ask the user which exec agent should own the change. Edit these globs to
fit each project's real layout.

## Working agreement (every agent respects)

- **Accuracy > speed.** Verify before claiming done. Tests pass ≠ feature works.
- **Read the Memory Bank first.** `.memory-bank/index.md` is the source of truth for what
  the project is. Missing → say so, do not invent project facts.
- **Disagree loudly.** Request wrong, scope bloated, plan flawed → say it, offer one
  alternative. Do not play along.
- **Stay in your scope.** An exec agent touches only its layer. Cross-layer impact →
  note it in the return for the sibling agent, do not reach across.
- **Edit > Write.** Change existing files; add new ones only when the plan calls for them.
- **No comments that narrate code.** Only *why* comments for a non-obvious invariant.
- **Security by default.** No injection, no hardcoded secrets. Validate external input at
  the boundary.
- **Ask before risky actions:** deleting files/branches, force push, dropping deps,
  anything visible outside the repo.
- **Terse output.** Agents answer terse: drop filler, keep every technical fact. Code,
  commits, PRs: written normally.
