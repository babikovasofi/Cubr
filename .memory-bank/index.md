# Memory Bank — Cubr

> Точка входа. Агент читает первым при старте (auto-инжект хуком). Карта ниже —
> ссылки на тематические файлы с деталями.

# Cubr — веб-дуэли по спидкубингу, судья = компьютерное зрение (React+TS+Vite · FastAPI · Postgres)

Active: этапы 0–2.4 + vision-профили + серверные скрамблы + scramble↔solve binding (Этап 3)
+ Этап 4 дуэль-по-ссылке + Этап 5 турнир (attempt-lifecycle, борд, finalize) + V2-пачка (бейджи,
график, share-card, звуки, скрамбл дня) + Этап 6 лендинг/правила/приватность — код готов (review ship).
Этап 3 честность спивотили: остаток (frames+OpenCV, event-stream) блокирован R1/камерой — вернёмся
после ресурса. Открыты гейт 0.3 (точность ≥90%), manual QA камеры/соло, остаток Этапа 6 (мобильная
заглушка, фильтр ников, деплой). Детали: tasks/README.md.

## Map
- product-overview/README.md — что/кому, MVP, ритуал сборки; нейминг Cubr/CubeDuel
- product-overview/vision.md — мастер-ТЗ: видение, MVP, модель данных
- product-overview/risks.md — R1–R9; главный R1: цвета кубика (зрение)
- product-overview/roadmap.md — бэклог V2/V3/V4, монетизация
- product-overview/feature-scramble-visual.md, feature-cube-profiles.md — утв. фичи
- tech-details/README.md — стек (таблица «почему»), архитектура, модули
- tech-details/solutions.md — КАК: зрение, реалтайм, анти-чит (П1–П12)
- tech-details/user-flow.md — экраны + mermaid-флоу MVP
- tech-details/design-system.md — дизайн «Плейфул-поп»; макеты в design-reference/
- steerings/development-conventions.md — конвенции, ветки, секреты, bundled skills
- steerings/testing-conventions.md — как тестим
- steerings/self-improvement.md — рефлексия → правила/хуки
- tasks/README.md — статус этапов, текущий фокус; полный чеклист в workplan.md
- transcripts/README.md — транскрипты встреч

## Dev loop
/plan → /build → /review (+ /debug); отчёты swarm-report/; роутинг агентов AGENTS.md;
Stop-хук test-gate блокирует «готово» без прогона тестов.
