# Plan: proof-frame ingestion   (slug: proof-frames)   — BLOCKED

## Verdict: skeptic = BLOCK. Do not /build as scoped.

## Why (skeptic HIGH#1–3, all sharp)
- **Presence-only = dead column + liability.** With OpenCV re-read out of scope, `honesty=="verified"`
  is UNREACHABLE — every legit solve lands `pending`, a cheater attaching any 2 JPEGs also lands `pending`.
  Honest and cheating solves are indistinguishable. Zero deterrence.
- **Storing PII frames before a reader exists breaches П10.** The product promises "кадры удаляются
  после проверки". Persisting JPEGs server-side with NO consumer (OpenCV not built) = pure privacy
  liability + storage/DoS on solo (highest-volume flow), base64-in-JSON +33% body bloat.
- **Required-vs-optional trap.** Anon solo = client no-op (never hits server); offline/no-camera/DNF
  produce no frames; client capture doesn't even exist yet (`verify_frames_ok` is a bare bool, no bytes
  ever produced). Required → breaks all those. Optional → cheater just omits frames = same `pending`.
  "missing → rejected" would mass-false-reject every honest cameraless solve (rejected is terminal).

## Skeptic's recommended resolutions
- **(A) Merge frame ingestion + OpenCV re-read into ONE brick** — so stored bytes have a same-ticket
  consumer. This is the honest architecture. But it's LARGE: server-side Python re-reads the cube
  colors from JPEGs and compares post-scramble frame↔scramble state, final frame↔solved. That
  reimplements the TS vision pipeline in Python and is tangled with **R1 (cube colors — the #1 project
  risk)**; it needs its OWN accuracy validation (a server-side analogue of gate 0.3, which hasn't even
  passed in-browser yet).
- **(B) Column-only, no bytes:** land `honesty` driven off the EXISTING `verify_frames_ok` bool, store
  NO image bytes (no bytea, no upload, no TTL surface). Cheap, live, no privacy liability — but weak
  (client-trust) and largely records the axis in DB rather than enforcing anything.

## Strategic note (orchestrator)
The remaining Этап-3 honesty bricks are NOT clean autonomous work:
- Frames+OpenCV (option A) = big R&D, R1-coupled, needs its own accuracy gate.
- Event stream + server timestamps (§П5.1) = meaningful only over WS/realtime = **Этап 4 (duels)**, not
  a single solo POST. A solo HTTP POST cannot produce server-observed inter-event timing.
- The one clean, shippable Этап-3 brick — **scramble persistence + solve↔scramble binding** — is DONE
  (shipped this session).

So Этап-3 "честность" is effectively at a decision point, not a coding queue.

## Blockers (user decides — see report)
**B1 — direction.** (A) big frames+OpenCV R&D brick now, (B) cheap honesty column off verify_frames_ok
(no bytes), or (C) treat scramble-binding as the Этап-3 MVP honesty floor and pivot autonomous work
elsewhere until camera/OpenCV R&D is resourced.

## Out of scope / Assumptions
See skeptic findings above; nothing built until B1 resolved.
