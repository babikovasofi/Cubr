# Development Conventions — Cubr

> Соло-разработка. Дисциплина важнее скорости — проект большой, скоуп-крип
> главный организационный риск (R6). Полный план этапов — [tasks/workplan.md](../tasks/workplan.md).

- **Language / stack:** Frontend TypeScript (React+Vite+Tailwind); Backend Python 3.12+ (FastAPI). Пакетники: pnpm (или npm), uv (или poetry).
- **Структура монорепо:**
  ```
  Cubr/
  ├── docs/        # проектные доки (зеркало важного из .memory-bank при нужде)
  ├── frontend/    # React + TS (Vite)
  ├── backend/     # FastAPI
  ├── prototype/   # черновики Этапа 0 (потом переедут во frontend)
  └── TODO.md      # Сейчас (этап N) / Дальше / Бэклог
  ```
- **Branching:** ветка на этап (`stage-0-vision`, `stage-1-solo`, …). Merge в `main`
  только при выполненном **DoD этапа** + тег (`v0.1-vision`). Мелкие частые коммиты
  с понятными сообщениями. (Прим.: сейчас ветка `chore/bootstrap-skeleton` — скелет.)
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`), сабж ≤50 симв.
- **Дисциплина этапов:** не начинать этап N+1, пока N не работает по DoD. Новая идея
  посреди работы → одна строка в `TODO.md`/[roadmap](../product-overview/roadmap.md),
  возврат к текущей задаче. Критерии «этап готов» писать заранее, не размывать.
- **Журнал решений:** `docs/decisions.md` — одна строка на решение («выбрала X потому что Y»).
- **Прототип Этапа 0 не вылизывать** — его судьба быть переписанным в Этапе 1, это норма.
- **Портфолио:** скриншоты/гифки прогресса после каждого этапа.
- **File-size limit / decomposition rule:** 400 строк (опциональный PostToolUse size-hook,
  `--wire-size-hook`, тюнинг через `$FILE_LINE_LIMIT`).
- **Секреты:** только в `.env` (git-ignored); в код/Memory Bank — никогда.
