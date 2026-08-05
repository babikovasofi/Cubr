# Plan: solve honesty-verdict axis   (slug: solve-status)

**Premise correction (both planner + skeptic HIGH#1):** `solve.status` ALREADY EXISTS —
`SOLVE_STATUSES=("valid","dnf","rejected")`, default `valid`, and PB/best_single keys on
`status=="valid"`. It is the **result-validity** axis. The requested honesty verdict
(pending/verified/rejected) is a **different, orthogonal axis** and must be a NEW column
(`honesty`), NOT a repurpose of `status`. Also already present: `verify_frames_ok:bool`
(client-supplied proto-signal).

## The four honesty-adjacent axes (must not be conflated)
| Axis | Where | Meaning | Set by |
|------|-------|---------|--------|
| `status` valid/dnf/rejected | DB | result validity; rejected = anti-cheat terminal | client picks valid\|dnf; rejected server-only |
| `verify_frames_ok` bool | DB | raw "frames attached/ok" input signal | client (`cameraVerified`) |
| **`honesty` pending/verified/rejected (NEW)** | DB | post-solve evidence verdict | **server only** |
| `validated` bool | session/solve, NOT in DB | calibration QUALITY (full 6-face vs quick-adjust) | vision |

Precedence to record in solutions.md (skeptic MED): **Ranked (Этап 4) requires
`validated==true AND honesty=="verified"`; either false → not ranked.**

## TL;DR
Add a server-only `honesty` verdict column (default pending). But skeptic HIGH#3: a column
with **no setter** is inert YAGNI and a latent PB-semantics landmine. → **Blocker B1: ship
it now alone, or bundle it with its first real setter (frame-validation brick), or design-note only?**

## Acceptance criteria (if B1 = ship-now path chosen)
- New Solve rows default `honesty == "pending"` (model default + server_default), no client input.
- SolveRead exposes `honesty`; POST /solves with `honesty` in body → 422 (extra="forbid" already blocks; just don't add to SolveCreate).
- Migration 0005 (down_revision `0004_scrambles`): `honesty` String(16). **Nullable, NULL for dnf** (skeptic HIGH#2 — dnf orthogonal to honesty) OR NOT NULL server_default "pending" — decide with B1.
- `app/services/solve_honesty.py::evaluate_solve_status()` stub returns "pending", called from create_solve; docstring names the two future flip points (frame-presence/sequence validation, OpenCV re-read).
- **Frozen invariant:** PB / GET /solves stay honesty-agnostic; any future honesty filter = its own reviewed ticket (skeptic HIGH#3).
- Existing 65 backend tests still green (no PB/filter change).

## Plan (ship-now path)
- `models/solve.py`: add `HONESTY_STATUSES=("pending","verified","rejected")`, `honesty` String(16) portable (NOT sa.Enum — sqlite tests), next to status/verify_frames_ok.
- `schemas/solve.py`: add `honesty` to SolveRead only; leave SolveCreate untouched.
- `services/solve_honesty.py` NEW: no-op stub + transition contract docstring. DNF → stays pending/NULL.
- `routers/solves.py`: `solve.honesty = evaluate_solve_status(...)` single authoritative path; do NOT gate PB/GET.
- `migrations/versions/0005_solve_honesty.py` NEW: down_revision 0004_scrambles; String(16); mirror 0004 hand-written style.
- `tests/test_solves.py`: default pending; SolveRead exposes it; body-set → 422; dnf interplay; stub unit test; PB regression green.
- `.memory-bank/tech-details/solutions.md`: record the 4-axis table + Ranked precedence (design note — lands regardless of B1).

## Blockers — RESOLVED
**B1 → note-only + reorder (user pick).** No code/migration this ticket. Landed instead:
the 4-axis reconciliation table + Ranked precedence + frozen PB invariant in
`.memory-bank/tech-details/solutions.md` (under П5). The `honesty` column + migration 0005 +
`evaluate_solve_status()` are **deferred to the frame-validation brick** that first sets them —
so the column is live from row 1, never dead, no silent PB-break window. Stage-3 sequencing
reordered: next brick = event-stream / frame ingestion (which bundles honesty).

**This plan's "ship-now path" below is NOT executed — kept as the honesty-column spec for the
frame-validation brick to reuse.**

## Out of scope
- Actual frame-validation / OpenCV re-check logic (the real setters).
- Gating PB / GET /solves on honesty (would change current behavior — NOT now).
- Merging/deprecating existing `status=="rejected"` or `verify_frames_ok` into honesty.
- Any frontend change to read/display/filter honesty.

## Assumptions
- Honesty values exactly pending/verified/rejected, portable String(16), server-only.
- `evaluate_solve_status` is the single sanctioned flip point; later bricks extend it, not scatter mutations.
- DNF solves are not honesty-checked now (NULL or pending — B1 decides).
