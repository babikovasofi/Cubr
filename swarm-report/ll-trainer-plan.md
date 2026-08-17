# Plan: last-layer case trainer (PLL)   (slug: ll-trainer)

## TL;DR

Frontend-only practice page at `/trainer`: pick a PLL case (or several), get a short
move sequence guaranteed to leave the cube in exactly that case. No solver, no search —
the scramble is constructed as `[orientation] + invert(alg) + AUF`, which by
construction returns the case's algorithm's own setup. cubejs stays a **test-only**
dependency; the runtime ships plain data (algorithm strings + facelet strings) and zero
network calls. Covers the full closed set of **21 PLL cases**; **0 OLL cases** — OLL is
explicitly out of scope, not partially done. Public route, no `ProtectedRoute`, no
`DesktopOnlyGate` (rationale below). Every algorithm and every stored facelet string is
proven against cubejs by test — never eyeballed.

## Acceptance criteria

- `/trainer` is reachable without auth and without `DesktopOnlyGate`; linked from the
  landing page and from the dashboard as a mode card (design-system §6.2 ModeCard +
  MiniGrid).
- The full closed set of 21 PLL cases is covered. OLL is not covered at all in this
  feature — stated plainly in the report, not glossed as "partial OLL".
  "Следующий случай" outputs a scramble string in standard notation; applying it to a
  solved cube yields exactly the selected case — proven by a model test, not eyeballed.
- With multiple cases selected, the answer (case name, algorithm, diagram) is hidden by
  default; "Показать ответ" reveals it.
- Zero network calls from the page: mounting `TrainerPage` with a mocked `fetch` and
  exercising every control asserts 0 calls. No import from `src/api/`. Nothing is written
  to `solves` (§П5 — practice writes zero rows).
- Case selection and the "any grip" toggle survive reload via localStorage; a broken
  store falls back to sane defaults without breaking the page.
- All 21 algorithms and all 21 stored facelet strings are verified against cubejs by
  test; a completeness test proves the set is exactly 21 distinct PLL cases with none
  missing and none duplicated.
- `frontend`: `npm test` green, `npm run typecheck` 0 errors, `npm run lint` clean,
  `npm run build` succeeds, prettier check clean. `package.json` unchanged — no new
  runtime dependency.
- EN dictionary extended for every new UI string; the existing dictionary-health test
  passes (case ids like `Aa`/`Ub`/`Ga` are proper nouns and are NOT translation keys).

## Plan

### Design decisions

**Route gating — no `DesktopOnlyGate`, no `ProtectedRoute`.** `DesktopOnlyGate` exists
specifically for ritual routes that raise the camera/WebSocket (`/solo`, `/tournament`,
`/daily`, `/duel/*`). The trainer has no camera, no timer, no socket — it is text, a
diagram, and a button, and it is *more* usable on a phone (cube in hand, screen beside
it) than most existing modes. `ProtectedRoute` is also skipped: the page reads and
writes zero user data (no solves, no badges, no profile, no backend call at all);
gating a purely client-side tool behind signup would cost conversion for no benefit and
would contradict §П5 (practice is not competitive, is not persisted). `/trainer` is
public, same tier as `/rules` and `/privacy`; solo already runs anonymously, so there's
precedent. Loaded via `lazy()` like the other secondary pages, so the landing bundle
doesn't grow.

**Generation approach — construction, not search.** No solver is used or needed. A
case's state is *defined* as "apply the case's algorithm's inverse to a solved cube."
So: `scramble = [orientation-prefix] + invert(alg) + AUF`, `AUF ∈ {"", "U", "U2", "U'"}`.
This is correct by construction for any algorithm string — the risk moves entirely to
"is the stored algorithm actually the case it claims to be," which is what the test
battery exists to prove independently (see below).

**No runtime cube model.** cubejs is used only in tests. The scramble is a plain string
concatenation; the last-layer diagram is drawn from a facelet string stored in the case
table. Both the algorithm and the facelet string are hardcoded data, each proven against
cubejs by test. This keeps `/trainer`'s bundle to data + markup — no cubejs, no cubing
CDN, no twisty-player on the practice page.

**AUF vs. whole-cube rotation.** A bare `y`/`y2`/`y'` prefix is *provably identical* to
an AUF for a last-layer case: conjugating a solved-F2L state by `y` fixes F2L and
relabels the last layer exactly the way a `U` turn does. So rotating the whole cube
around the vertical axis adds zero new states and is not shipped as a "harder" mode —
it would just be a second name for the same AUF. What *does* add a real skill is a
full **random re-orientation among all 24** cube orientations before generation (an
"any grip" toggle, default off): the case still ends up on top, but in different
physical colors, training color-neutral recognition. This orientation lives only in the
*displayed scramble string* — the model-level correctness proof always operates on the
canonical (un-rotated) case state and separately verifies orientation-invariant
matching (see Test plan). `validateFacelets` requires identity centers, so a rotated
state is never asserted with plain `===`; the test oracle normalizes centers back
before touching `vision/cubeState.ts` helpers.

**Case identity must not be provable from the algorithm alone.** The trap: "apply `alg`
to `invert(alg)` applied to solved → solved" is tautological and passes even if `alg`
is simply wrong, since the two are self-consistent by construction. To close this, each
case in the table carries an **independent** specification transcribed from standard
PLL diagrams — not derived from the algorithm: corner cycle and edge cycle (with
direction) over fixed position labels, the element's order (2 or 3), and `inverseOf`
for the six mirror-pairs. A completeness test enumerates all 288 legal last-layer
permutation states, groups them by canonical (AUF-normalized) signature, and asserts
exactly 22 classes (21 PLL + solved) with the table's 21 declared cycles matching 21
distinct non-solved classes with no gaps and no duplicates. Order of work matters: the
independent spec and the completeness test are written and passing **before** a single
algorithm string is typed in, so the spec can't be unconsciously fitted to the
algorithm.

**Case-name authority.** PLL letter names disagree across sources in a few spots
(Ja/Jb, Ua/Ub swap conventions; Ga–Gd assignment varies). The table cites ONE canonical
source in its header comment (speedsolving.com wiki PLL page) so a labelling dispute
has one place to resolve against; in the UI the diagram (derived from the model) is
treated as authoritative and the letter as a secondary caption — a wrong label alone
then can't teach the wrong finger trick.

**Notation constraints.** cubejs's parser only accepts single-letter face/slice/rotation
tokens (`U R F D L B M E S x y z`, lowercase wide `u r f d l b`) each optionally
followed by `'` or `2` — it throws on multi-character tokens like `Rw`, `Uw2`, or on
parenthesized groups. When transcribing an algorithm from a source that uses `Rw`/`Uw`-
style wide-move notation or bracket grouping, it MUST be rewritten to the cubejs-
compatible lowercase-wide, bracket-free form (`Rw` → `r`, `Uw` → `u`, `(R U R') (F' U F)`
→ `R U R' F' U F`) before it is stored in the table. The very first assertion in the
per-case structural test is that the algorithm parses without throwing — a parse
failure is a data bug, caught immediately, not somewhere downstream.

**Test-oracle surface.** `frontend/src/vision/cubejs.d.ts` currently declares `co`/`eo`
(orientation arrays) and `cornerParity()`/`edgeParity()` but not the raw permutation
arrays. The test oracle needs corner/edge *permutation* (not just orientation) to derive
cycles for the independent-spec check, so the ambient types gain `cp: number[]` and
`ep: number[]` (test-only consumers; nothing in `src/` outside `vision/` reads them).
No other cubejs surface is added — no `Cube.inverse`, no `multiply` — since `invertAlg`
is hand-rolled in `generate.ts` and proven correct against the model directly (apply
`alg` then `invertAlg(alg)` to solved → solved, for all 21 cases plus synthetic strings
covering `x/y/z`, `M/S/E`, and wide moves), which is a stronger proof than trusting
cubejs's own inverse.

**Branch hygiene.** Current worktree branch (`fix/vision-stickerless-facefit`) carries
uncommitted, unrelated vision-accuracy work. Per the task's own instructions, `feat/ll-
trainer` branches from a freshly-pulled `main`, not from this branch — the trainer
touches zero files under `vision/` besides adding two read-only type declarations to
`cubejs.d.ts`.

### Affected files

- `frontend/src/lib/rng.ts` — NEW. `mulberry32(seed): () => number`, seeded PRNG (none
  exists in the repo yet; everything today uses `Math.random`). General-purpose, not
  trainer-specific.
- `frontend/src/trainer/pll.ts` — NEW. The 21-case table: `id`, `group`, `alg`,
  `facelets`, `cornerCycle`/`edgeCycle` (independent spec), `order`, `inverseOf`. Types
  `PllCaseId`, `PllCase`, `PllGroup`; helpers `ALL_CASE_IDS`, `casesByGroup`,
  `getCase(id)`. Header comment cites the canonical naming source. Zero cubejs import.
- `frontend/src/trainer/generate.ts` — NEW. `AUFS`, `ORIENTATIONS` (24 prefixes),
  `invertAlg(alg)`, `simplifyMoves(tokens)` (collapse same-face repeats, drop no-ops),
  `pickCase(ids, rng)`, `generateCaseScramble(caseDef, {rng, anyGrip})`. `rng` defaults
  to `Math.random`, injectable for tests. Zero cubejs import.
- `frontend/src/vision/cubejs.d.ts` — extend ambient `Cube` with `cp: number[]` and
  `ep: number[]` (test-oracle use only).
- `frontend/src/components/cubeColors.ts` — NEW. `FACE_COLOR` map, face letter → CSS
  color. White as a literal (`--surface` inverts in dark mode — the exact trap already
  documented at the top of `HeroStickers`), the rest via existing tokens.
- `frontend/src/components/LastLayerDiagram.tsx` — NEW. Flat last-layer diagram drawn
  from a facelet string: 3×3 U-face grid + 12 side stickers from the top rows of
  F/R/B/L. No rotation/animation. Header comment notes the deliberate `HeroStickers`-
  style exception to the "≤2 bright colors" rule (this is a cube-face glyph, not a UI
  accent). `aria-hidden` on the grid plus a text caption.
- `frontend/src/trainer/useTrainer.ts` — NEW. Screen-state hook: selected case ids,
  `anyGrip`, current draw, `revealed`, `next()`, `reveal()`, `toggleCase()`,
  `selectAll()`, `selectGroup()`. Persists selection to localStorage
  (`cubr.trainer.pll.cases`, `cubr.trainer.pll.anyGrip`) via a guarded accessor
  (existing `cubr_countdown_muted` pattern); corrupt/missing value falls back to "all
  cases"; the last checkbox can't be unchecked into an empty state.
- `frontend/src/pages/TrainerPage.tsx` — NEW. ≤720px column per the lobby layout
  (§6.2). Case-selection chips grouped (edges-only / corners-only / adjacent-swap /
  diagonal-swap / G-perms), "any grip" `SegmentedToggle`, monospace scramble card
  (`surface`, radius 10px, IBM Plex Mono 13px — matches §6.1's scramble line), primary
  "Следующий случай", secondary "Показать ответ" (name + algorithm + diagram). Space =
  next, Enter = reveal (guarded against interactive-element focus). Zero import from
  `src/api/`.
- `frontend/src/App.tsx` — `lazy(() => import("./pages/TrainerPage"))`, route
  `/trainer` with no `ProtectedRoute`/`DesktopOnlyGate` wrapper, alongside `/rules` and
  `/privacy`.
- `frontend/src/pages/HomePage.tsx` — mode card "Тренажёр PLL" (own `MiniGrid` accent);
  for anonymous visitors it links straight to `/trainer`, not `/register`.
- `frontend/src/i18n/en.ts` — English strings for the new screen. Case names (`Aa`,
  `Ub`, `G-perm`, …) are NOT translated — international notation.
- Tests: `frontend/tests/trainer/model.ts` (test-only oracle, not shipped),
  `frontend/tests/trainer/pllTable.test.ts`, `frontend/tests/trainer/
  pllCompleteness.test.ts`, `frontend/tests/trainer/generate.test.ts`,
  `frontend/tests/trainer/facelets.test.ts`, `frontend/tests/trainer/
  TrainerPage.test.tsx`, `frontend/tests/lib/rng.test.ts`.

### Steps

1. `frontend/src/lib/rng.ts` (`mulberry32`) + its test — smallest brick, no
   dependencies.
2. Test oracle `frontend/tests/trainer/model.ts` (tests-only): `applyMoves(facelets,
   alg)` over `Cube.fromString().move().asString()`; `normalizeCenters(facelets)`
   (re-labels a whole-cube-rotated string back to identity centers before it touches
   `validateFacelets`); `llSignature(facelets)` (corner/edge cycles from `cp`/`ep`);
   `canonicalSignature` = min signature over `U^i · state · U^j`, i,j ∈ 0..3;
   `sameCaseUpToAufAndOrientation(a, b)` using the 24 orientations from
   `vision/faceletRotations.orientationVariants`. Reuses `vision/cubeState.ts` (`SOLVED`,
   `validateFacelets`) and `vision/faceletRotations.ts` — no new cube model.
3. Fill `pll.ts` with the **independent** spec only (id, group, cornerCycle/edgeCycle,
   order, inverseOf) — no algorithms yet. Write and run `pllCompleteness.test.ts`
   against this alone: 288 states → exactly 22 classes, 21 declared cycles land in 21
   distinct non-solved classes. A failure here means the spec itself is wrong, caught
   before any algorithm is typed in.
4. Fill in the 21 `alg` strings from the canonical source, normalized to cubejs
   notation. Run `pllTable.test.ts`. Every failure is fixed by correcting the
   algorithm — never the test, never the independent spec.
5. Generate `facelets` for each case by running the model and paste the result into the
   table; `facelets.test.ts` pins them to the model permanently.
6. `invertAlg` + `simplifyMoves` + `generateCaseScramble` in `generate.ts`; run
   `generate.test.ts`.
7. `cubeColors.ts` + `LastLayerDiagram.tsx`; diagram-from-facelets test.
8. `useTrainer.ts` (state + localStorage) and `TrainerPage.tsx` per design-system §1/
   §4/§5; page tests.
9. Wiring: route in `App.tsx` (public, unlazy-gated only by `lazy()`), mode card on
   `HomePage`, English strings in `en.ts`.
10. Full check: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
    prettier. Confirm `package.json` is untouched.

## Test plan

- **[pllTable] structure**, per case, on `state = applyMoves(SOLVED, invertAlg(alg))`:
  (S1) algorithm parses without throwing; (S2) centers of `state` are identity — no
  stray whole-cube rotation or unclosed slice move; (S3) everything outside the last
  layer (D face + bottom two rows of F/R/B/L) matches `SOLVED` — F2L intact; (S4) all 9
  U-face stickers are `'U'` — this is a PLL, not an OLL; (S5) `state !== SOLVED` and
  isn't any of the 4 AUF variants of solved — algorithm isn't a no-op; (S6)
  `validateFacelets(state).ok === true` (reuses the existing solvability check).
- **[pllTable] identity**, per case: (I1) cycles derived from `state` (canonicalized by
  AUF) equal the declared `cornerCycle`/`edgeCycle`; (I2) all 21 canonical signatures
  are pairwise distinct; (I3) applying `alg` `order` times returns to solved, `order-1`
  times does not; (I4) for each declared `inverseOf` pair, composing the two algorithms
  returns to solved up to AUF.
- **[pllCompleteness]**: enumerate all 288 legal last-layer permutation states (corner
  perm σ × edge perm τ, matching parity), group by `canonicalSignature`. Assert exactly
  22 classes; exactly one is solved; each of the other 21 is covered by exactly one
  table entry.
- **[generate] scramble leaves the declared case** — exact equality, not "close enough":
  for all 21 cases × all 4 AUF, `applyMoves(SOLVED, scramble) === applyMoves(caseState,
  auf)`. For "any grip": for all 21 × 4 AUF × 24 orientations,
  `sameCaseUpToAufAndOrientation(applyMoves(SOLVED, scramble), caseState)`.
- **[generate] AUF doesn't change the case**: the 4 AUF variants per case yield 4
  distinct state strings but one `canonicalSignature`; none of the 21×4 variants is
  ever misidentified as a different case.
- **[generate] never solved**: none of the 21×4 (or 21×4×24) draws equals `SOLVED` or
  an AUF-of-solved.
- **[generate] determinism**: `generateCaseScramble`/`pickCase` seeded with
  `mulberry32(42)` produce byte-identical output across two runs of 100 draws; a
  different seed diverges. Distribution: over 4000 draws, all 4 AUF (and, with "any
  grip", all 24 orientations) appear; with an N-case selection, all N ids appear.
- **[generate] `simplifyMoves` preserves state**: for all 21×4 draws,
  `applyMoves(SOLVED, raw) === applyMoves(SOLVED, simplified)`; no two adjacent
  same-face moves remain; targeted cases `U U'` → empty, `U U` → `U2`, `U2 U2` →
  empty, `R U U' R'` → empty.
- **[generate] `invertAlg` is a correct inverse**: `applyMoves(applyMoves(SOLVED, a),
  invertAlg(a)) === SOLVED` for all 21 algorithms plus synthetic strings covering
  `x/y/z`, `M/S/E`, and wide moves.
- **[facelets] stored data matches the model**: for all 21, the table's `facelets`
  field is character-for-character `applyMoves(SOLVED, invertAlg(alg))` — the only
  thing keeping the runtime cubejs-free without silent drift.
- **[LastLayerDiagram] output-from-facelets**: `SOLVED` → all 9 U cells one color, 3
  side stickers per F/R/B/L in that face's color; a case's facelets → U face
  single-colored (PLL), side stickers permuted exactly at the declared positions. Test
  reads `data-*` attributes, not pixel colors.
- **[TrainerPage] screen behavior**: no selection defaults to "all cases"; "Следующий
  случай" changes the scramble string; "Показать ответ" reveals name/algorithm/diagram
  (absent from the DOM before the click); single-case selection shows the name
  immediately; unchecking the last case is a no-op (can't reach empty selection);
  selection and "any grip" round-trip through localStorage; a throwing localStorage
  (getItem/setItem) doesn't crash the page.
- **[TrainerPage] §П5 — zero network**: mount with `vi.spyOn(globalThis, "fetch")`,
  assert 0 calls across render, "Следующий случай", and "Показать ответ". Static check
  that `src/trainer/**` and `TrainerPage.tsx` import nothing from `src/api/`.
- **[i18n]**: new EN strings pass the existing dictionary-health test; separate
  assertion that case ids (`Aa`/`Ub`/…) are NOT present as dictionary keys.
- **[rng]**: `mulberry32` — same seed ⇒ same sequence; values in `[0,1)`; two different
  seeds diverge on the first value.

## Blockers

None requiring a human decision before `/build`. Every skeptic HIGH finding has a
concrete resolution folded into this plan:

1. *Tautological test* → independent per-case spec + completeness test, written and
   passing before any algorithm string exists (Steps 3–4).
2. *Whole-cube rotation ≠ real difficulty* → dropped; replaced with "any grip"
   (24-orientation) toggle, which is a genuinely different skill (color neutrality),
   not the thing the skeptic correctly flagged as useless.
3. *Rotated states break `validateFacelets`/`===`* → orientation lives only in the
   displayed scramble string; the model-level oracle normalizes centers and compares
   via `sameCaseUpToAufAndOrientation`, never bare `===`, on rotated states.
4. *Case-match can't be string equality* → `canonicalSignature` / AUF+orientation
   matching, not `===`, used everywhere except the single "post-alg cube is solved"
   assertion where `===` is correct.
5. *cubejs notation is narrower than published algorithms* → explicit normalization
   rule (Design decisions → Notation constraints) plus S1 (parses without throwing) as
   the first assertion in the battery.
6. *Case-label authority (Ja/Jb, Ga–Gd disputes)* → one cited canonical source in the
   table header; diagram treated as authoritative over the letter in the UI.

## Out of scope

- OLL entirely — 0 cases. The machinery generalizes (orientation signature instead of
  permutation signature, 216 states instead of 288, 57 classes instead of 21), but 57
  algorithms can't be transcribed and proven with the same rigor in one pass. Separate
  feature.
- Any link to the camera, timer, or solve ritual — the trainer doesn't measure time or
  verify the human actually solved the case. Wiring into the ritual is a separate
  feature.
- Backend, migrations, persisted results, recognition-speed stats, training badges.
  Zero rows in `solves` (§П5), zero endpoints.
- User-supplied custom algorithms or choosing between alternate algs for one case.
- Permutation-arrow overlays on the diagram (derivable from `cornerCycle`/`edgeCycle`
  later, but is separate visual work) — v1 diagram shows colors only.
- A "don't repeat the last draw" nicety for regeneration, and F2L/coach-analytics
  trainers from the same roadmap line — nice-to-haves, not this pass.
- A solver-search-based scramble generator, a second cube model/dependency, and
  `<twisty-player>`/CDN rendering of the case — rejected alternatives (see plan
  rationale above); none is needed.

## Assumptions

- The Memory Bank is silent on the trainer beyond the V3 roadmap line; taking exactly
  the 21-PLL slice is consistent with "ship one feature to completion before the next."
- The trainer's target user already reads WCA notation — a scramble string without a
  move-by-move walkthrough is sufficient; `ScrambleWalkthrough` is not reused here.
- localStorage key style follows the newer, dotted convention (`cubr.scramble.
  showNotation`) over the older underscore one.
- Case letter names (Aa, Ub, G-perm, …) are international notation and are not
  translated in either language.
- The test oracle lives at `frontend/tests/trainer/model.ts`, not under `src/`, so
  cubejs never re-enters the `/trainer` runtime chunk.
