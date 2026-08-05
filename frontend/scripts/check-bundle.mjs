// Держит первый экран лёгким. Запускается как npm `postbuild`.
//
// Проверок две, и вторая важнее первой.
//
// 1. Размер входного чанка. Просто число, которое видно, когда оно поехало.
// 2. В входном чанке нет MediaPipe. Ленивость ритуальных роутов держится на
//    том, что НИ ОДИН нележащий за `lazy()` модуль не импортирует камеру
//    статически. Достаточно одного `import { useHands }` в шапке или на
//    лендинге — и распознавание рук молча возвращается в первый экран.
//    Размер при этом вырастет сразу на сотни килобайт, но заметить это по
//    логу сборки некому, а ошибка выглядит как обычный импорт.
//
// Бюджет — не догма: выросла функциональность, обоснованно подними число.
// Смысл в том, чтобы поднять его осознанно, а не обнаружить полтора мегабайта
// через полгода.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "dist", "assets");

const ENTRY_BUDGET_KB = 320;
// Маркеры-строки самих библиотек: `HandLandmarker` — публичный класс MediaPipe.
const LAZY_ONLY_MARKERS = [["MediaPipe (распознавание рук)", "HandLandmarker"]];

const entries = readdirSync(ASSETS).filter((f) => /^index-.*\.js$/.test(f));
if (entries.length !== 1) {
  console.error(`[check-bundle] ожидался один входной чанк index-*.js, найдено: ${entries.length}`);
  process.exit(1);
}

const entry = join(ASSETS, entries[0]);
const source = readFileSync(entry, "utf8");
const sizeKb = Buffer.byteLength(source) / 1000;

const problems = [];

if (sizeKb > ENTRY_BUDGET_KB) {
  problems.push(
    `входной чанк ${sizeKb.toFixed(1)} kB при бюджете ${ENTRY_BUDGET_KB} kB. ` +
      "Либо унести новое за React.lazy, либо поднять бюджет в scripts/check-bundle.mjs.",
  );
}

for (const [name, marker] of LAZY_ONLY_MARKERS) {
  if (source.includes(marker)) {
    problems.push(
      `${name} попал во входной чанк: кто-то из НЕленивых модулей импортирует его ` +
        "статически. Найти импорт и либо унести страницу за lazy(), либо импортировать " +
        "динамически.",
    );
  }
}

if (problems.length === 0) {
  console.log(`[check-bundle] входной чанк ${sizeKb.toFixed(1)} kB / ${ENTRY_BUDGET_KB} kB — ок`);
  process.exit(0);
}

for (const p of problems) console.error(`[check-bundle] ERROR: ${p}`);
process.exit(1);
