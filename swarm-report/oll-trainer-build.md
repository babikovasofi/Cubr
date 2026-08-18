# Build: last-layer case trainer, extended to OLL   (slug: oll-trainer)

Extends the existing `/trainer` page (PLL-only, `feat/ll-trainer`, PR #21) with the
full 57-case OLL set, a PLL/OLL/both set picker, and a dedicated OLL diagram. Branch
`feat/oll-trainer`, cut from `origin/main` at `37384d6` (already up to date with
`origin/main` at task start — `git fetch` showed no new commits to pull).

Single react-ts exec agent (this report's author) implemented the plan, wrote and ran
the full test battery, and ran the check suite — no separate planner/tester/reviewer
pass; the task was handed directly with the plan's shape already specified in the
prompt (mirror `pll.ts`'s two-phase construction, generalized to orientation).

## Source for the 57 algorithms

Fetched the speedsolving.com wiki's OLL page (same source `pll.ts` cites for PLL) for
case numbers, nicknames, and algorithms; hand-normalized every algorithm to cubejs's
notation (stripped parens, collapsed redundant `2'` suffixes to `2`) before it touched
any code. Correctness of the *algorithms themselves* does not rest on trusting that
fetch — see "How correctness was proven" below; only the *nicknames* (`name` field)
are carried through without independent verification, which is disclosed as this
build's least-confident decision.

## Enumeration result

**216 legal (corner-orientation × edge-orientation) last-layer states → exactly 58
canonical classes (1 solved + 57 OLL)** — matches the classic OLL case count exactly.
Verified twice, independently:

1. During construction, in a throwaway Node script (`node` + the real `cubejs`
   package, not trusted arithmetic) that enumerated all 216 states, grouped them by
   canonical signature, and printed the count *before* a single algorithm string was
   written into `oll.ts`.
2. In the committed test suite, `tests/trainer/ollCompleteness.test.ts`, which
   re-derives the same 216 → 58 result from scratch (independent enumeration code, no
   shared state with the throwaway script) and additionally checks the table's 57
   declared `cornerTwist`/`edgeFlip` rows land on exactly those 57 non-solved classes,
   bijectively — no gaps, no duplicates. This test was green (57, not some other
   number) before `oll.ts` had a single `alg` field filled in; if the enumeration had
   produced anything other than 58, the plan was to stop and re-derive the equivalence
   model, not force a match — it produced exactly 58 on the first correct model, after
   one wrong turn (see below).

**One real wrong turn, corrected, not hidden**: the equivalence group for OLL
orientation-only states is a **4-element cyclic group** (a single U turn shifts both
the corner-twist and edge-flip arrays together), *not* PLL's 16-element group
(4 post-shifts × 4 pre-shifts). PLL's 16-way group is a genuine feature of
*permutation* data — prepending a U turn before a permutation-changing algorithm is a
different operation than appending one. For pure orientation data it is not: prepending
a U turn to the sequence that reaches an identity-permutation orientation state
produces a state with a *non-identity* permutation, which falls outside the 216-state
space entirely, so there is no meaningful "pre-multiply" analogue to fold in. Using the
16-way group by naive analogy would have under-collapsed the state space to a much
smaller (wrong) class count; the correct 4-way group was confirmed against real `cubejs`
`co`/`eo` state transitions (a small runtime check comparing `shift(co)` predictions
against what applying an actual `"U"` move does) before being written into
`tests/trainer/model.ts`'s `canonicalOllSignatureFromArrays`. This 4-vs-16 distinction
is documented at length in `oll.ts`'s header and `model.ts`'s OLL section, not just
fixed silently.

## How the 57 algorithms were proven correct

Same two-phase discipline `pll.ts` used, generalized:

1. **Phase 1 (algorithm-blind)**: enumerate the 216 legal orientation states, group
   into 58 canonical classes, declare each of the 57 non-solved classes' own
   `cornerTwist`/`edgeFlip` directly from the enumeration — zero algorithm involved.
   `ollCompleteness.test.ts` locks this down.
2. **Phase 2**: for each of the 57 fetched-and-normalized algorithms, compute
   `state = applyMoves(SOLVED, invertAlg(alg))`, extract its own orientation signature
   from real `cubejs` `co`/`eo` arrays, and match it against the Phase-1 declared
   classes by *exact structural equality* — not eyeballed, not assumed. All 57 matched
   to 57 *distinct* rows with zero unmatched and zero duplicates on the first
   consistent (4-way-group) model — a strong, hard-to-fake correctness signal, since a
   single mistyped algorithm would either fail to parse, land outside the 216-state
   space, or collide with another row's class.

`ollTable.test.ts` pins this permanently: per case, the algorithm parses (S1), leaves
centers untouched (S2), leaves F2L (D face + side bottom rows) untouched (S3), leaves
at least one U-face sticker non-`'U'` — i.e. genuinely *not* solved-orientation (S4),
isn't solved or an AUF-of-solved (S5), is a legal solvable cube (S6), and its
orientation (canonicalized by AUF) equals the row's *independently declared*
`cornerTwist`/`edgeFlip` (I1) — the check that actually catches a wrong algorithm,
since "invert then re-apply solves" alone is tautological (same trap `pll.ts`'s header
already named). All 57 canonical signatures are pairwise distinct (I2).

**A real surprise found while building this, not assumed away**: `pll.ts`'s
construction implicitly relied on PLL algorithms being orientation-neutral. The mirror
assumption for OLL — that a genuine OLL algorithm is *permutation*-neutral — is
**false**. Checked empirically: every one of the 57 algorithms, run in isolation from a
solved cube, leaves a non-identity last-layer *permutation* behind (real OLL algorithms
are only required to fix orientation; PLL cleans up whatever permutation resulted,
regardless of which OLL algorithm was used). This is why `cornerTwist`/`edgeFlip` — not
`facelets` — is the case's identity spec, and why `OllDiagram` (unlike PLL's
`LastLayerDiagram`) deliberately does not render real per-face colors on the diagram —
they would be algorithm-incidental, not diagnostic. Documented in `oll.ts`'s header.

## What changed in PLL's shared code, and why it didn't break PLL

- **`generate.ts`**: `pickCase`/`generateCaseScramble` were typed to `PllCaseId`/
  `PllCase` only because OLL didn't exist yet; genericized to `<T extends string>` /
  `<T extends ScrambleCase>` (`ScrambleCase = { alg: string; facelets: string }`).
  `PllCase` and `OllCase` both satisfy this structurally without either importing the
  other. The construction itself (`[orientation] + invertAlg(alg) + AUF`) never
  inspected which case set it was building for, so the generalization is a pure type
  widening — no behavior change for PLL callers, confirmed by re-running
  `generate.test.ts` (PLL's own suite) unchanged and green after the edit.
- **`LastLayerDiagram.tsx`**: extracted its grid-layout JSX into a new
  `LastLayerGrid.tsx` (facelets + a `colorFor` resolver), so `OllDiagram` doesn't fork
  the markup. `LastLayerDiagram.tsx` itself becomes a 10-line wrapper passing
  `FACE_COLOR` as `colorFor`; output is byte-identical to before (same
  `data-testid`/`data-face`/`data-slot` attributes, same `TILE` classes) — confirmed by
  re-running `LastLayerDiagram.test.tsx` (pre-existing PLL suite) unchanged and green.
- **`useTrainer.ts`/`TrainerPage.tsx`**: rewritten (not incrementally patched) to carry
  a `sets: TrainerSet[]` alongside selection, with the legacy-storage migration path
  described below. Old localStorage keys are read (never written) as a fallback only.
- **Nothing touched**: `pll.ts`, `pllCompleteness.test.ts`, `pllTable.test.ts`,
  `model.ts`'s PLL-specific functions (`cyclesFromPerm4`, `permFromCycles`,
  `canonicalSignatureFromPerm`, etc. — new OLL functions were *added* alongside them,
  none renamed or altered), `App.tsx`'s route registration.

## Backward compatibility (localStorage)

A visitor with a pre-OLL PLL-only selection saved under the old keys
(`cubr.trainer.pll.cases`, `cubr.trainer.pll.anyGrip`) keeps it exactly: `useTrainer`'s
`readState()` tries the new keys (`cubr.trainer.sets`, `cubr.trainer.cases`) first, and
only falls back to the legacy PLL key — read-only — when both new keys are absent. A
migrated visitor lands on "PLL only, their saved case subset (or all 21 if the saved
value is empty/corrupt), their saved any-grip flag" — identical to what they had before
OLL shipped. Any interaction after that writes forward to the new keys only. Covered by
`TrainerPage.test.tsx`'s "legacy PLL-only storage is honored" and "a corrupt legacy
selection falls back to all 21 PLL cases" cases.

## Changed files (all under `frontend/`)

| File | What |
|------|------|
| `src/trainer/oll.ts` | NEW — 57-case OLL table: independent `cornerTwist`/`edgeFlip` spec, algorithm, facelets, community number/nickname, structural `group` |
| `tests/trainer/model.ts` | extended with the OLL orientation oracle (`cornerTwistFromArray`/`edgeFlipFromArray` + inverses, `canonicalOllSignature(FromArrays)`, `ollSignature`, `sameOllCaseUpToAuf(AndOrientation)`) — PLL's own functions untouched |
| `tests/trainer/ollCompleteness.test.ts` | NEW — 216 → 58 classes, 57 declared rows land bijectively, group counts 7+3+47=57 |
| `tests/trainer/ollTable.test.ts` | NEW — per-case S1–S6/I1–I2 battery |
| `tests/trainer/facelets.test.ts` | extended with an OLL `describe.each` block alongside the existing PLL one |
| `src/trainer/generate.ts` | genericized `pickCase`/`generateCaseScramble` over a new `ScrambleCase` interface |
| `tests/trainer/ollGenerate.test.ts` | NEW — mirrors `generate.test.ts` for OLL: exact-equality scramble-lands-on-case (57×4 AUF), any-grip, AUF-invariance, never-solved, PLL/OLL never confused, determinism, mixed-pool draw |
| `src/components/LastLayerGrid.tsx` | NEW — grid layout extracted out of `LastLayerDiagram.tsx` |
| `src/components/LastLayerDiagram.tsx` | refactored to a thin wrapper over `LastLayerGrid` (real per-face colors); behavior unchanged |
| `src/components/OllDiagram.tsx` | NEW — binary oriented/not-oriented rendering over the same `LastLayerGrid` |
| `tests/components/OllDiagram.test.tsx` | NEW |
| `src/trainer/useTrainer.ts` | rewritten: `sets`/`selectedIds` state, legacy-storage migration, `toggleSet`/`selectPllGroup`/`selectOllGroup` |
| `src/pages/TrainerPage.tsx` | rewritten: set-toggle UI, per-set group/case sections (genericized `GroupChips`/`CaseCheckboxGroup`), PLL/OLL diagram dispatch |
| `tests/pages/TrainerPage.test.tsx` | rewritten for the new UI + legacy-migration coverage |
| `src/i18n/en.ts`, `tests/i18n/trainer.test.ts` | new/renamed strings; both tables' ids/names checked to never leak in as dictionary keys |
| `src/pages/HomePage.tsx`, `tests/pages/HomePage.test.tsx` | mode-card copy updated to the new title/case count |

`package.json` / `package-lock.json` unchanged — no new runtime dependency (cubejs
stays test-only, same as before).

## Test counts

- Before this branch (per the PLL build report): frontend vitest **1042** (some drift
  possible since from unrelated commits on `main`; re-verified the actual pre-feature
  baseline is not needed here since the delta below is measured against this branch's
  own commits).
- After this feature: **1665** tests, all green — net **+several hundred** across the
  new OLL-specific suites (`ollCompleteness`, `ollTable`, `ollGenerate`,
  `OllDiagram.test.tsx`) plus extensions to `facelets.test.ts`, `trainer.test.ts` (i18n),
  `TrainerPage.test.tsx`, `HomePage.test.tsx`.

## Checks — real output

```
$ npm test
 Test Files  97 passed (97)
      Tests  1665 passed (1665)

$ npm run typecheck
> tsc --noEmit -p tsconfig.app.json
(clean, 0 errors)

$ npm run lint
> eslint .
(clean, 0 errors)

$ npm run build
✓ built in 387ms
[check-bundle] входной чанк 312.1 kB / 320 kB — ок
(TrainerPage-Dnl-84Iw.js: 29.87 kB / 7.20 kB gzip — its own lazy chunk, no cubejs leak)

$ npx prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.{ts,tsx}" "scripts/*.mjs"
Checking formatting...
All matched files use Prettier code style!
```

Ran all five gates together, in this order, more than once during the build (not just
once at the end) — the task's own instructions flagged that a green test run with a red
linter has bitten this project before.

## Least-confident decision

The `name` field (nicknames like "Runway", "Squeegee", "Right Back Squeezy") is sourced
from a single live fetch of the speedsolving.com wiki, summarized by a smaller model
reading the page — the same single-source caveat `pll.ts` already carries for its
letter names, but with materially less independent cross-checking than the algorithms
themselves got (which are proven by exact structural equality against an
algorithm-blind enumeration; the *names* are not verified by anything). A wrong or
disputed nickname is cosmetic — `id`/`number` (1–57) is what the code and tests treat
as authoritative, and the diagram (derived from the proven `cornerTwist`/`edgeFlip`,
not the name) is what actually teaches the case — but if a working cuber ever flags one
of the 57 nicknames as wrong, that's the one place in this build a wrong value could
have slipped through unnoticed.

## Cross-layer notes

None — frontend-only, no backend/devops touch, no new dependency, no API contract.

## PR / CI

PR: https://github.com/babikovasofi/Cubr/pull/25 (base `main`, head `feat/oll-trainer`).
Not merged, not deployed — CI status to be confirmed on the PR checks tab.
