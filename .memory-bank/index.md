<!-- RULE: только указатели, максимум 25 строк. Инжектится в каждую сессию.
     Факты — в файлах ниже. Перед работой над темой — прочти её файл. -->
# Cubr — веб-дуэли по спидкубингу, судья = компьютерное зрение (React+TS+Vite · FastAPI · Postgres)

Active: этапы 0–2.4 + vision-профили + серверные скрамблы + scramble↔solve binding (Этап 3)
+ Этап 5 турнир attempt-lifecycle код готовы (review ship). Этап 3 честность спивотили: остаток
(frames+OpenCV, event-stream) блокирован R1/камерой или Этапом 4 — вернёмся после ресурса. Открыты
гейт 0.3 (точность ≥90%), manual QA камеры/соло, живые миграции 0004/0005. Детали: tasks/README.md.

## Map (перед работой над темой — прочти её файл)
- product-overview/README.md — что/кому, MVP, ритуал сборки; нейминг Cubr/CubeDuel
- product-overview/vision.md — мастер-ТЗ: видение, MVP, модель данных
- product-overview/risks.md — R1–R9; главный R1: цвета кубика (зрение)
- product-overview/roadmap.md — бэклог V2/V3/V4, монетизация
- product-overview/feature-scramble-visual.md, feature-cube-profiles.md — утв. фичи
- tech-details/README.md — стек (таблица «почему»), архитектура, модули
- tech-details/solutions.md — КАК: зрение, реалтайм, анти-чит (П1–П12)
- tech-details/user-flow.md — экраны + mermaid-флоу MVP
- tech-details/design-system.md — дизайн «Плейфул-поп»; макеты в design-reference/
- steerings/development-conventions.md — конвенции, ветки, секреты, bundled skills, правила index
- steerings/testing-conventions.md — как тестим
- steerings/self-improvement.md — рефлексия → правила/хуки
- tasks/README.md — статус этапов, текущий фокус; полный чеклист в workplan.md
- transcripts/README.md — транскрипты встреч

## Dev loop
/plan → /build → /review (+ /debug); отчёты swarm-report/; роутинг агентов AGENTS.md;
Stop-хук test-gate блокирует «готово» без прогона тестов.
