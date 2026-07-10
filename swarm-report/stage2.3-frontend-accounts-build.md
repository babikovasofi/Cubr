# Build: Этап 2.3 — фронт: аккаунты   (slug: stage2.3-frontend-accounts)

Plan: [stage2.3-frontend-accounts-plan.md](stage2.3-frontend-accounts-plan.md).
Cross-layer, последовательно: **python-fastapi (backend `/solves` + auth-твики) → react-ts (фронт)**.

## A. Backend (agent: python-fastapi) — done
Changed: `models/solve.py` (UUID→портируемый `GUID`), `schemas/solve.py` (NEW SolveCreate/Read),
`routers/solves.py` (NEW POST/GET), `main.py` (include), `routers/auth.py` (OAuth callback →
`FRONTEND_URL/auth/callback?ok=1`/`?error=`), `tests/conftest.py` (+Solve table), `tests/test_solves.py` (NEW).
- `services/email.py` уже строил ссылки на фронт (`/verify?token=`, `/reset-password?token=`) — не тронут.
- Solve без `cube_id` (придёт в 2.4).

**API:** `POST /solves` (auth, body `{scramble,time_ms>0,status?:valid|dnf,verify_frames_ok?}` → 201 SolveRead;
`rejected`/invalid → 422; anon → 401; апдейт `best_single_ms` только на быстрее-valid). `GET /solves`
(auth, `?limit&offset`, свои, created_at desc; anon → 401).

**Гейты (проверено дважды):** `ruff` clean · `mypy app` clean · `pytest 27 passed`.

## B. Frontend (agent: react-ts) — done
Changed (кратко): `vite.config.ts` (dev-proxy `/api`→:8000 strip), `vercel.json` (NEW prod-rewrite,
плейсхолдер-host до 2.6), `src/api/{client,auth,solves}.ts`, `src/store/authStore.ts` (zustand
loading|authed|anon, `bootstrap()` one-shot `/users/me` probe), `src/auth/{ProtectedRoute,AuthShell,
GoogleButton}.tsx` + `onboarding.ts`, `src/components/{Input,Toast,Spinner}.tsx`, страницы
`{Login,Register,VerifyEmail,ForgotPassword,ResetPassword,OAuthCallback,Onboarding,Profile}Page.tsx`,
`src/onboarding/useCameraCheck.ts` (reuse useCamera+useHands), `App.tsx` (роуты + auth-header + bootstrap),
`src/solo/{solveSave.ts,useSoloSession.ts,ResultScreen.tsx}` + `SoloPage.tsx`, 3 теста.

**Skeptic-констрейнты соблюдены:** dev+prod proxy (относительный `/api` только); login form-urlencoded
`username`; fastapi-users ошибки (string|`{code,reason}`)→RU-мэп (нет `[object Object]`); httpOnly cookie →
session только через `/users/me` (401=норма, без console-шума); ProtectedRoute без вспышки + `?next=`;
OAuth full-redirect + `/auth/callback?ok/error`; verify/reset ?token auto-POST; forgot нейтральный;
онбординг камера-чек + cube-placeholder; solo→createSolve fire-and-forget (anon no-op, 401 не теряет результат).

**Гейты (проверено дважды):** `typecheck` 0 · `test` **97 passed** (+26 новых) · `lint` clean · `build` OK (72 модуля).

## Браузер-смоук (main, анон — без бэка)
`/login` рендерится в дизайн-системе, консоль пустая; header анон-aware (Войти/Регистрация); форма
Почта/Пароль/Войти/Забыли-пароль/Google/регистрация. `bootstrap()` probe без бэка деградировал в `anon`
graceful (нет console-error). Скрин снят.

## Осталось (manual QA — нужен Postgres+Docker / реальные ключи / камера)
- Полный стек: `docker-compose up -d` (Postgres) + `uvicorn app.main:app` + фронт → цикл
  register→verify(email-токен)→login→onboarding→solo-save→profile-история.
- Google OAuth: authorize→callback `?ok=1` возвращает залогиненным (cookie через proxy).
- Камера-чек онбординга (реальная камера + MediaPipe).
- **Deviation-флаг:** DNF при `elapsedMs=0` — `buildSolvePayload` клампит `time_ms=max(1,round)` (бэк требует >0).
  Если бэк предпочитает DNF вообще не слать 1мс-плейсхолдером — решить (сейчас шлём).
- **Prod-proxy:** `vercel.json` host = плейсхолдер `REPLACE_WITH_BACKEND_URL_AT_DEPLOY` (Этап 2.6).
