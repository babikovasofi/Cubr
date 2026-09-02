
## 2026-09-02 22:33 · /messages full-screen chat (uncommitted diff, 7 files + 5 untracked)
Вердикт: BLOCK · Сборка ✅ (2 pre-existing ошибки tsc в tests/lib/password.test.ts, не из этого диффа) · Тесты ✅ (1966/1966, включая 28 новых в friends/chat)
Находки: 🔴 1 · 🟡 2 · 🔵 1
Ключевое: ChatSection.tsx:60-65 — deep-link эффект (унаследован из старого кода, не новый) переоткрывает ?friendship= при КАЖДОМ обновлении chat.conversations (после любого send/poll-wake), включая срабатывание сразу после нажатия "←" на мобиле — на новом полноэкранном /messages это бьёт по основному сценарию использования гораздо чаще, чем раньше.
