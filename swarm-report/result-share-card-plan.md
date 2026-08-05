# Plan: Карточка результата для соцсетей (result-share-card)   (slug: result-share-card)

## TL;DR
Frontend-only shareable PNG card of a solo/duel result, hand-drawn on a 1080×1080
`<canvas>` (no DOM-snapshot lib, no new dep). Primary action «Скачать PNG»
(always available); «Поделиться» via `navigator.share({files})` shown ONLY when
`navigator.canShare({files})` is true (desktop-safe: share is progressive
enhancement, not the main flow). Palette resolved from the live CSS-var tokens
via `getComputedStyle` (theme-aware, hardcoded default fallback when empty);
fonts explicitly `document.fonts.load(...)`-ed before drawing. Wired into solo
`ResultScreen` and duel `DuelResult`. Read-only; §П5/honesty untouched; the duel
card mirrors ONLY the on-screen data (slot times + outcome) — never `winner_id`,
email, rating, or the h2h opponent identity.

**Skeptic returned `revise` (4 HIGH); all resolved.** HIGH#1 `scramble` isn't a
prop today → thread `s.scramble` (SoloPage) / `state.scramble` (DuelPage) in.
HIGH#2 custom Google-Fonts (Rubik + IBM Plex Mono) → `document.fonts.load()` the
exact drawn weights before `fillText`, in-string fallback stacks. HIGH#3 canvas
can't use `var(--x)` → `getComputedStyle` resolve per render + default-palette
fallback. HIGH#4 `share({files})` unsupported on most desktop → download primary,
share gated behind `canShare({files})` at click time, in the gesture. Plus MED
(toBlob null / only local vector / revoke objectURL / jsdom mocks) and LOW
(client render-time date, privacy parity, no html2canvas).

## Acceptance criteria
- Solo result renders a «Скачать PNG» action (always) and «Поделиться» ONLY when
  `navigator.canShare({files:[png]})` is true. Download saves
  `cubr-result-<ts>.png`; share opens the native sheet with the PNG File.
- The PNG shows: formatted time (e.g. «12.34»), the scramble string
  (word-wrapped), a date, and the «Cubr» wordmark; colors match the CURRENT
  theme (light/dark) via resolved CSS-var tokens.
- DNF solo card renders «DNF» in the danger token, keeps scramble+date+wordmark,
  shows no numeric time.
- Duel card shows the SAME outcome already on screen: outcome label
  (Ничья / Ты выиграл / Не в этот раз — reuse DuelResult's computed label), your
  time, opponent time, scramble, date, wordmark. No email, no rating/cups, no
  h2h identity, and NEVER `winner_id`/any UUID.
- `toBlob` returning null, a null 2D context, or a share/render throw surfaces an
  inline `role="alert"` error and re-enables the button — never crashes the
  screen. A user-cancelled share sheet (`AbortError`) is a silent no-op.
- No backend endpoint, no migration, no new npm dependency (`package.json`
  unchanged). Card draws ONLY local vector + text (no external/cross-origin
  image → no canvas taint). Any `URL.createObjectURL` is revoked.
- tsc / eslint clean; all frontend tests green.

## Plan
- **`share/resultCard.ts`** (new) — pure-ish render module.
  - `interface CardData { kind:'solo'|'duel'; timeLabel:string; dnf:boolean;
    scramble:string; dateLabel:string; duel?:{outcome:string; you:string;
    opponent:string} }`.
  - `resolvePalette(): Palette` — read `getComputedStyle(document.documentElement)
    .getPropertyValue('--bg'|'--surface'|'--ink'|'--muted'|'--line'|'--primary'|
    '--success'|'--danger').trim()`; **if a value is `''` (jsdom / pre-mount) fall
    back to a hardcoded default hex per token** (so `fillStyle` is never invalid).
    Re-read every call so the `.dark` state is honored. Comment: `var(--x)` is NOT
    a valid canvas `fillStyle`.
  - `drawResultCard(ctx, data, palette)` — draws 1080×1080 imperatively: bg,
    top-left «Cubr» wordmark (primary, heavy Rubik), centered overline (Соло /
    Дуэль), big mono time (ink; danger «DNF» when `dnf`), scramble word-wrapped
    (manual `measureText` line-wrap) in muted mono, date in muted at bottom; duel
    → outcome label + two labeled columns (Ты / Соперник) with time strings.
    Injectable `ctx` so it's testable without a real canvas.
  - `renderCardBlob(data): Promise<Blob>` — create 1080×1080 canvas,
    `getContext('2d')` (reject if null), **`await ensureFonts()`** (see below),
    `drawResultCard`, `canvas.toBlob(b => b ? resolve(b) : reject(new Error(
    'toBlob null')), 'image/png')`.
  - `ensureFonts()` — `if (!document.fonts?.load) return;` then
    `await Promise.all([...])` of `document.fonts.load` for the EXACT weight/size/
    family strings drawn (e.g. `'900 96px "IBM Plex Mono"'`, `'800 40px "Rubik"'`);
    wrapped in try/catch (a font-load failure must not block the card — the
    in-string fallback stack keeps it legible).
- **`share/shareCard.ts`** (new) —
  - `canShareFiles(file: File): boolean` = `typeof navigator!=='undefined' &&
    !!navigator.canShare && navigator.canShare({files:[file]})`.
  - `shareOrDownload(blob, filename, meta): Promise<'shared'|'downloaded'>` — build
    `new File([blob], filename, {type:'image/png'})`; if `canShareFiles` →
    `navigator.share({files:[file], title, text})` (catch `AbortError` → return
    without throw; rethrow others); else download via `createObjectURL` + anchor
    `click()` + `revokeObjectURL` (finally / `setTimeout`).
- **`share/ShareCardButton.tsx`** (new) — behavior+presentational, prop
  `data: CardData`. Local `busy`/`error` state. A «Поделиться»/«Скачать PNG»
  button (feature-detect at CLICK time, since `canShare` needs a built File):
  `renderCardBlob(data)` → `shareOrDownload(...)`. Inline danger `<p role="alert">`
  on error; button re-enables. Reuses `components/Button`.
- **`solo/ResultScreen.tsx`** — add optional `scramble?: string` prop; render
  `<ShareCardButton>` (only when `scramble` present) beside «Ещё раз», building
  `CardData{kind:'solo', timeLabel:seconds, dnf, scramble, dateLabel:new
  Date().toLocaleDateString('ru-RU')}`.
- **`pages/SoloPage.tsx`** — pass `scramble={s.scramble}` into `<ResultScreen>`.
- **`duel/DuelResult.tsx`** — add `scramble: string | null` prop; render
  `<ShareCardButton>` next to «Реванш» (only when scramble present), building
  `CardData{kind:'duel', dnf:false, timeLabel:<your time>, scramble, dateLabel,
  duel:{outcome:<the on-screen outcomeLabel>, you:<fmt your time>,
  opponent:<fmt opp time>}}`. Never pass `winner_id`.
- **`pages/DuelPage.tsx`** — pass `scramble={state.scramble}` into `<DuelResult>`.

Card dims: fixed **1080×1080 PNG** (square — directly postable to IG/Telegram/VK;
OG 1200×630 is a link-preview ratio, rejected). No DPR scaling (it's an exported
image). Filename `cubr-result-${Date.now()}.png`. `meta` = short RU strings
(«Мой результат в Cubr»), no URL.

## Test plan
Full frontend coverage (`// @vitest-environment jsdom`). haiku authors exactly these.

### `tests/share/resultCard.test.ts`
- Mock canvas: stub `HTMLCanvasElement.prototype.getContext` → a fake 2D ctx
  (`vi.fn` for fillRect/fillText/measureText→{width}/save/restore/translate/
  clearRect, settable `fillStyle`/`font`); stub `toBlob` to invoke cb with a fake
  Blob; stub `getComputedStyle` to return a hex per var.
- `renderCardBlob` resolves a Blob; `drawResultCard` called `fillText` with the
  time label AND the scramble AND «Cubr».
- DNF data → draws «DNF», never the numeric time.
- `resolvePalette` empty getPropertyValue → falls back to default hex (no empty
  fillStyle).
- `toBlob(null)` → `renderCardBlob` rejects «toBlob null»; `getContext`→null →
  rejects.
- duel CardData → draws outcome label + both time columns; never draws a UUID.

### `tests/share/shareCard.test.ts`
- `canShare`→true + `navigator.share` resolves → `shareOrDownload` returns
  `'shared'`, share called with `files: File[]`.
- `navigator.share` rejects `AbortError` → resolves without throw.
- `navigator.share` rejects other Error → propagates.
- no `canShare` / `canShare({files})`→false → download branch:
  `createObjectURL` mocked, anchor `click` spied, `revokeObjectURL` called;
  returns `'downloaded'`.

### `tests/share/ShareCardButton.test.tsx` (RTL)
- Mock `../share/resultCard` + `../share/shareCard`; click → `renderCardBlob` +
  `shareOrDownload` called; a rejected render → inline `role="alert"` shown,
  button re-enabled (not stuck busy).

### `tests/solo/ResultScreen.test.tsx` / `tests/duel/DuelResult.test.tsx` (RTL, extend/new)
- Share button rendered ONLY when `scramble` prop present; absent when null.
- DNF solo still shows the share button (`CardData.dnf===true`).
- Duel card data carries the on-screen outcome/times, no `winner_id`.

## Blockers
None — all 4 skeptic HIGH resolved (scramble threading, explicit font-load,
getComputedStyle palette + default fallback, canShare-gated share/download
primary), MED/LOW baked in. Proceed to /build.

## Out of scope
- Backend endpoint / migration / persisted share record.
- New npm dep (html-to-image / satori / node-canvas) — hand-drawn 2D only.
- Network-specific share APIs, OG link-preview pages, server-side image gen.
- Honesty/§П5/cups/rating/ELO/h2h-identity on the card.
- Tournament result screen (only solo ResultScreen + duel DuelResult).
- User customization/branding of the card.

## Assumptions
- Card = 1080×1080 PNG (square) — safest directly-postable ratio; no Memory Bank
  social-target guidance.
- Date = render time (`new Date()`, ru-RU) — no per-solve timestamp is threaded
  into ResultScreen/DuelResult today; swap in a stored `createdAt` later if added.
- Solo scramble from `useSoloSession`'s `s.scramble` (SoloPage); duel scramble
  from `state.scramble` (DuelPage) — both already in scope, only a prop pass.
- Wordmark = the text «Cubr» in brand primary (no logo asset found); a real asset
  can be embedded as a data: URI later without changing the API.
- Custom fonts (Rubik / IBM Plex Mono) are already used on-screen so they're
  loading; `document.fonts.load` of the drawn weights + fallback stacks covers
  the not-yet-ready race.
