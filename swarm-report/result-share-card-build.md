# Build report: Карточка результата для соцсетей (slug: result-share-card)

Status: **implementation complete, tests green, ready for /review.**
Frontend-only, read-only. Autonomous build: frontend exec (sonnet) authored
both the feature AND the full plan Test plan → orchestrator verified. The
separate haiku tester step was SKIPPED as redundant (the exec agent's suite
already implements every test the plan lists, all green — re-authoring would be
pure churn; coverage verified below).

## Frontend (exec: sonnet)
New:
- `share/resultCard.ts` — `CardData`/`Palette`, `resolvePalette()`,
  `drawResultCard(ctx, data, palette)` (injectable ctx → unit-testable),
  `renderCardBlob(data)`, `ensureFonts()`.
- `share/shareCard.ts` — `canShareFiles(file)`, `shareOrDownload(blob, filename,
  meta) → 'shared'|'downloaded'`.
- `share/ShareCardButton.tsx` — one `Button` (secondary), busy/error state,
  inline `role="alert"` on failure.
Modified:
- `solo/ResultScreen.tsx` — optional `scramble?: string`; renders
  `ShareCardButton` beside «Ещё раз» when present.
- `pages/SoloPage.tsx` — passes `scramble={s.scramble}`.
- `duel/DuelResult.tsx` — new `scramble: string | null`; builds `CardData` from
  the already-computed `outcomeLabel`/`formatTime` ONLY (never `winner_id`/UUID);
  renders `ShareCardButton` next to «Реванш».
- `pages/DuelPage.tsx` — passes `scramble={state.scramble}`.

### Canvas / palette / font / share strategy (as implemented)
- 1080×1080 hand-drawn 2D canvas, flat `fillRect`s reusing the app's own
  "sticker" motif (offset ink block behind a bordered surface panel, matching
  `Button`'s `shadow-sticker`) — no invented look, no charting/DOM-snapshot lib,
  no external image (no taint), no new dep.
- `resolvePalette()` reads `getComputedStyle(document.documentElement)
  .getPropertyValue('--bg'|'--surface'|'--surface-2'|'--line'|'--ink'|'--muted'|
  '--primary'|'--success'|'--danger').trim()`, hardcoded light-theme hex fallback
  per token when empty (jsdom/pre-mount), re-read each `renderCardBlob` so `.dark`
  is honored. (Deviation: added `--surface-2` as `surfaceAlt` for the duel
  two-column look — an existing token, not required by acceptance criteria.)
- `ensureFonts()` guards `document.fonts?.load`, `Promise.all`s the 8 exact
  weight/size/family strings drawn (Rubik 800/700/500 + IBM Plex Mono 600/400,
  matching `index.css` @import), try/catch so a font failure never blocks; every
  drawn font string carries an in-canvas fallback stack.
- «Скачать PNG» is the single always-rendered label and the primary path;
  `shareOrDownload` builds the real `File` and feature-detects
  `navigator.canShare({files})` at CLICK time (in the gesture) before calling
  `navigator.share`. `AbortError` swallowed (silent), other errors rethrown to
  the button's `role="alert"`. Download revokes the ObjectURL.
- Privacy: duel card renders only slot times + the on-screen outcome; never a
  UUID/email. DNF solo → «DNF» in danger token, no numeric time.

## Tests + orchestrator verification
Suite (authored by the exec agent, matches the plan Test plan):
- `tests/share/resultCard.test.ts` (7) — mocked canvas ctx + toBlob +
  getComputedStyle: `renderCardBlob` resolves a Blob; draws time + scramble +
  «Cubr»; DNF draws «DNF» not a time; palette empty → default hex; `toBlob(null)`
  → rejects «toBlob null»; `getContext`→null → rejects.
- `tests/share/shareCard.test.ts` (6) — canShare→true share `'shared'` with
  `files:File[]`; `AbortError` → no throw; other error → propagates; no-canShare
  → download branch (createObjectURL/anchor click/revokeObjectURL) `'downloaded'`.
- `tests/share/ShareCardButton.test.tsx` (2) — click → render+share called;
  rejected render → `role="alert"` shown, button re-enabled.
- `tests/solo/ResultScreen.test.tsx` — button only when `scramble` present;
  absent when null; still shown on DNF.
- `tests/duel/DuelResult.test.tsx` (extended) — share button when scramble
  present; card built from outcome/times, not winner_id.

Orchestrator-run verification:
- `vitest` **418 passed** (45 files); `tsc` clean; `eslint` clean.
- `git diff --stat package.json package-lock.json` empty → zero new deps.

## Open / not covered
- Live browser share/download + the actual rendered pixels (needs a real
  canvas + device share sheet) — logic/branches are unit-tested against mocked
  canvas/share; jsdom has no real 2D canvas.
- Tournament result screen intentionally excluded (only solo + duel per scope).
- Date on the card = render time (`ru-RU`), not a stored solve timestamp (none is
  threaded today).
