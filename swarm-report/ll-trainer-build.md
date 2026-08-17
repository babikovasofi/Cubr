# Build: last-layer case trainer (PLL)   (slug: ll-trainer)

Plan: `swarm-report/ll-trainer-plan.md`. Branch `feat/ll-trainer`, cut fresh from
`origin/main` at `335d2b6` (not from the in-progress `fix/vision-stickerless-facefit`
worktree branch, which carries unrelated uncommitted vision work — per the plan's
branch-hygiene decision). PR: https://github.com/babikovasofi/Cubr/pull/21

## Agents run

1. **planner** + **skeptic** (opus, parallel) → merged into `swarm-report/ll-trainer-plan.md`.
2. **react-ts** exec agent (sonnet) → implemented plan steps 1–9.
3. **tester** (haiku) → audited the plan's Test plan section item-by-item against the
   exec agent's own tests; found full coverage already present, added nothing.
4. Orchestrator (this report's author) → ran the full check suite independently,
   committed the plan doc, pushed, opened the PR, confirmed CI.

## Changed files (all under `frontend/`)

| File | What |
|------|------|
| `src/lib/rng.ts` + `tests/lib/rng.test.ts` | `mulberry32` seeded PRNG (new general-purpose lib, not trainer-specific) |
| `src/vision/cubejs.d.ts` | added ambient `cp: number[]`, `ep: number[]` (test-oracle use only; nothing else under `vision/` touched) |
| `tests/trainer/model.ts` | test-only oracle: `applyMoves`, `invertAlg` cross-check, `normalizeCenters`, `llSignature`, `canonicalSignature`, `sameCaseUpToAufAndOrientation` — reuses `vision/cubeState.ts` (`SOLVED`, `validateFacelets`) and `vision/faceletRotations.ts`, no new cube model |
| `src/trainer/pll.ts` | the 21-case PLL table; independent cycle spec derived by brute-force enumeration of all 288 legal last-layer states *before* any algorithm was assigned (see file header for the full method) |
| `tests/trainer/pllCompleteness.test.ts` | 288 states → exactly 22 classes (1 solved + 21 PLL), the table's 21 rows cover them with no gaps/dupes |
| `tests/trainer/pllTable.test.ts` | per-case structural (S1–S6) + identity (I1–I4) checks |
| `tests/trainer/facelets.test.ts` | stored `facelets` field == `applyMoves(SOLVED, invertAlg(alg))`, char-for-char |
| `src/trainer/generate.ts` + `tests/trainer/generate.test.ts` | `invertAlg`, `simplifyMoves`, `pickCase`, `generateCaseScramble`; zero cubejs import |
| `src/components/cubeColors.ts`, `src/components/LastLayerDiagram.tsx` + test | flat last-layer diagram drawn from a facelet string; white as a literal (not `--surface`, which inverts in dark mode) |
| `src/trainer/useTrainer.ts`, `src/pages/TrainerPage.tsx` + test | screen state (selection, "any grip", reveal) with guarded localStorage persistence; page layout per design-system §1/§4/§5/§6.2 |
| `src/App.tsx` | `/trainer` route, `lazy()`-loaded, no `ProtectedRoute`/`DesktopOnlyGate` |
| `src/pages/HomePage.tsx` | "Тренажёр PLL" mode card, links straight to `/trainer` for anonymous visitors |
| `src/i18n/en.ts` | English strings for the new screen (case letters like `Aa`/`Ub`/`G-perm` are not translation keys) |
| `tests/i18n/trainer.test.ts`, `tests/pages/HomePage.test.tsx` | dictionary-health + routing coverage |

## Deviations from the plan (disclosed by the exec agent, reviewed and accepted)

1. **`canonicalSignature`** uses full two-sided `U^i · state · U^j` equivalence
   (pre- *and* post-AUF), not only post-AUF — required empirically to collapse the 288
   states into exactly 22 classes as the plan specifies. Documented in `model.ts`.
2. **Independent spec derivation method**: rather than hand-transcribing cycles from
   PLL diagrams, the spec was derived by brute-force enumerating all 288 legal states
   and grouping by canonical signature — a stronger, purely combinatorial form of
   "independent of any algorithm" than diagram memory. Real algorithms were matched
   afterward by exact permutation equality against one of the 21 enumerated classes,
   not eyeballed. Disclosed at length in `pll.ts`'s header.
3. **`inverseOf` pair count**: only 4 genuine algebraic-inverse pairs exist among the
   21 verified algorithms (Ua/Ub, Aa/Ab, Ga/Gb, Gc/Gd) — verified by actually composing
   algorithms and checking the result solves up to AUF, not assumed from letter-naming
   convention. The plan's "six mirror-pairs" estimate was a guess; the actual count is
   a fact about this specific set of 21 verified algorithms, disclosed in `pll.ts`.
4. **`LastLayerDiagram` side-strip layout** is a good-faith arrangement, not verified
   against one specific textbook rotation convention — acceptable since the plan scopes
   v1 to colors/positions only, and tests assert `data-*` attributes, not the picture.

None of these weaken the correctness guarantee the plan's Blockers section required;
all are stronger or equally-strong versions of what was specified.

## Checks — real output, run independently by the orchestrator

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.app.json
(clean, 0 errors)

$ npm run lint
> eslint .
(clean, 0 errors)

$ npx prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.{ts,tsx}" "scripts/*.mjs"
Checking formatting...
All matched files use Prettier code style!

$ npm test
 Test Files  92 passed (92)
      Tests  1042 passed (1042)
   Duration  4.59s

$ npm run build
✓ built in 385ms
[check-bundle] входной чанк 311.2 kB / 320 kB — ок
(TrainerPage-BoTovWGm.js: 12.36 kB / 3.89 kB gzip — its own lazy chunk, no cubejs leak)
```

`package.json` / `package-lock.json` unchanged — no new runtime dependency.

Pre-existing frontend test count before this branch: 787 (per Memory Bank, `main` at
the prior session). Post-feature: **1042** — net **+255** tests, all trainer/rng-related
or coverage additions to existing suites (e.g. `HomePage.test.tsx` mini-grid-count
assertion updated 3→4 for the new mode card).

## Cross-layer notes

None — frontend-only feature, no backend/devops touch. `frontend/src/vision/cubejs.d.ts`
gained two read-only ambient type fields (`cp`, `ep`); no runtime file under `vision/`
was modified.

## PR / CI

PR: https://github.com/babikovasofi/Cubr/pull/21 (base `main`, head `feat/ll-trainer`).
CI (`.github/workflows/ci.yml`, both suites): triggered on push, see PR checks tab for
current status — polled separately, not merged, not deployed.
