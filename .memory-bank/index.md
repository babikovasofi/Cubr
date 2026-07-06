# Memory Bank — Cubr

> Entry point. The agent reads this first to orient. Keep it short; link out.
> This file is auto-injected at session start by .claude/hooks/inject-memory-bank.*

## Overview
**Cubr** — веб-платформа для соревновательного спидкубинга: спидкуберы играют
дуэли онлайн, а роль судьи выполняет **компьютерное зрение через камеру** —
проверяет честность перемешивания по скрамблу, ловит старт/стоп по рукам на
столе и подтверждает, что кубик собран. Долгосрочно — соцсеть кубинг-сообщества.
Цель — реальный продукт, не учебное демо. Разработка соло, десктоп/ноутбук.

> Рабочее название в ранних доках — **CubeDuel**; канонично имя проекта **Cubr**
> (репо, README, план работ). Логотип-словомарк на макетах пока «CubeDuel» —
> переименовать в брендинге (см. [tasks](tasks/README.md)).

## Map
- [Product Overview](product-overview/README.md) — что и для кого
  - [Vision / ТЗ](product-overview/vision.md) — мастер-документ: видение, MVP, модель данных
  - [Risks](product-overview/risks.md) — R1–R9, отсортированы по опасности
  - [Roadmap](product-overview/roadmap.md) — бэклог V2/V3/V4 + монетизация
- [Tech Details](tech-details/README.md) — стек, архитектура, модули
  - [Solutions](tech-details/solutions.md) — КАК решать: зрение, реалтайм, анти-чит (П1–П12)
  - [User Flow](tech-details/user-flow.md) — экраны + mermaid-флоу MVP
  - [Design System](tech-details/design-system.md) — утверждённый дизайн «Плейфул-поп»
  - [Design Reference](tech-details/design-reference/README.md) — макеты дизайн-борда (скрины)
- [Development Conventions](steerings/development-conventions.md) — как кодим
- [Testing Conventions](steerings/testing-conventions.md) — как тестим
- [Self-Improvement Loop](steerings/self-improvement.md) — рефлексия → правила/хуки
- [Tasks](tasks/README.md) — этапы 0–6, текущий фокус
  - [Workplan](tasks/workplan.md) — полный чеклист этапов + DoD
- [Transcripts](transcripts/README.md) — записи встреч → текст

## Стек (кратко)
Фронт: React + TS (Vite) + Tailwind · зрение рук MediaPipe Hands (JS) · зрение
кубика — своя логика (canvas + Lab/ΔE) · cubejs. Бэк: Python + FastAPI +
WebSockets · PostgreSQL + SQLAlchemy · fastapi-users (email+пароль + Google
OAuth). Хостинг: фронт Vercel, бэк+БД Railway/Render.

## Ключевой риск
**Зрение кубика (R1)** — цвета сливаются (белый/жёлтый, красный/оранжевый).
Митигация: калибровка по собранному кубику каждую сессию + Lab/ΔE +
кластеризация 9×6. Этап 0 (прототип зрения) идёт первым — риск-киллер.

## Secrets
Copy `.env.example` → `.env` and fill it (HuggingFace token for transcribe, etc.).
`.env` is git-ignored.

## Bundled skills
This project ships its own copies under `.claude/skills/` — no external
marketplace needed. Utility: memory-bank, memory-bank-defrag, transcribe,
design-process, anti-ai-slop-writing, anti-slop-design, mattermost, solidtime,
reflect. Dev-loop: plan, build, review, debug. Update:
`bash <startpoint>/scripts/bootstrap.sh --upgrade-skills . --force`

## Dev loop
Features go through `/plan "<feature>"` → `/build <slug>` → `/review <slug>`,
with `/debug "<error>"` when something breaks. Plans and reports land in
`swarm-report/`. Agent roster + routing table: `AGENTS.md`. A Stop hook
(test-gate) blocks "done" claims until the project's tests actually ran.

## Status
Raw ТЗ/дизайн разобраны и разложены по Memory Bank (2026-07-06). Кода ещё нет —
следующий шаг Этап 0: прототип зрения. См. [tasks](tasks/README.md).
