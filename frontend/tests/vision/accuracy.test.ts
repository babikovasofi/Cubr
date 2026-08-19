import { describe, it, expect } from "vitest";
import {
  scoreRead,
  formatReport,
  formatRawGrids,
  colorBalanceRu,
  concentratedMismatchRu,
  type CellDiag,
} from "../../src/vision/accuracy";
import { SOLVED, FACE_ORDER, type Facelet } from "../../src/vision/cubeState";
import { COLOR_NAMES } from "../../src/vision/colors";
import { config } from "../../src/vision/config";

describe("FACE_ORDER <-> COLOR_NAMES identity", () => {
  it("the facelet face order matches the calibration color order (URFDLB)", () => {
    // The accuracy harness assembles reads by capture order and scores against
    // URFDLB ground truth; that only aligns if these two orderings are identical.
    expect([...FACE_ORDER]).toEqual([...COLOR_NAMES]);
    expect([...FACE_ORDER]).toEqual(["U", "R", "F", "D", "L", "B"]);
  });
});

describe("scoreRead", () => {
  it("scores a perfect read 54/54 and PASSes", () => {
    const rep = scoreRead(SOLVED, SOLVED);
    expect(rep.total).toBe(54);
    expect(rep.correct).toBe(54);
    expect(rep.fraction).toBe(1);
    expect(rep.pass).toBe(true);
    // No off-diagonal confusion.
    for (const e of FACE_ORDER) {
      for (const r of FACE_ORDER) {
        expect(rep.confusion[e][r]).toBe(e === r ? 9 : 0);
      }
    }
  });

  it("counts each mismatch and records its confusion cell", () => {
    const a = SOLVED.split("");
    a[0] = "R"; // expected U, read R
    a[9] = "F"; // expected R, read F
    const read = a.join("") as Facelet;
    const rep = scoreRead(read, SOLVED);
    expect(rep.correct).toBe(52);
    expect(rep.confusion.U.R).toBe(1);
    expect(rep.confusion.R.F).toBe(1);
    expect(rep.confusion.U.U).toBe(8);
  });

  it("fails when below the pass fraction", () => {
    const a = SOLVED.split("");
    for (let i = 0; i < 10; i++) a[i] = a[i] === "R" ? "U" : "R"; // ~10 wrong
    const rep = scoreRead(a.join(""), SOLVED, 0.9);
    expect(rep.pass).toBe(false);
  });

  it("does not crash or pollute confusion on non-face characters (isFace guard)", () => {
    const a = SOLVED.split("");
    a[0] = "X"; // not a face letter
    const rep = scoreRead(a.join(""), SOLVED);
    expect(rep.correct).toBe(53); // X != U -> wrong
    // 'X' is not a face, so no confusion cell is incremented for index 0.
    let off = 0;
    for (const e of FACE_ORDER) for (const r of FACE_ORDER) if (e !== r) off += rep.confusion[e][r];
    expect(off).toBe(0);
    expect(rep.confusion.U.U).toBe(8); // the other 8 U stickers still counted
  });
});

describe("formatReport", () => {
  it("renders a PASS line and the confusion header", () => {
    const out = formatReport(scoreRead(SOLVED, SOLVED));
    expect(out).toContain("PASS");
    expect(out).toContain("Confusion");
  });

  it("lists mismatches when present", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    const out = formatReport(scoreRead(a.join(""), SOLVED));
    expect(out).toContain("Mismatches");
    expect(out).toContain("read R, expected U");
  });

  it("без диагностики отчёт остаётся прежним — ни kept, ни отрыва", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    const out = formatReport(scoreRead(a.join(""), SOLVED));
    expect(out).not.toContain("kept");
    expect(out).not.toContain("Почему ошиблись");
  });

  // Три болезни дают одинаковую строку «прочиталось не то», а лечатся по-разному.
  // Диагностика обязана их различать: пересвет — по kept, слипшиеся эталоны — по
  // отрыву от второго кандидата.
  it("к промаху приписывает kept и отрыв, а выбитую ячейку помечает", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    a[1] = "B";
    const diags: CellDiag[] = Array.from({ length: 54 }, () => ({
      rgb: [200, 200, 200] as [number, number, number],
      kept: 0.9,
      best: "U",
      bestDE: 3,
      second: "D",
      secondDE: 40,
    }));
    diags[0] = {
      rgb: [180, 60, 60],
      kept: 0.05,
      best: "R",
      bestDE: 8,
      second: "L",
      secondDE: 26.5,
    };
    diags[1] = {
      rgb: [40, 90, 190],
      kept: 0.8,
      best: "B",
      bestDE: 11,
      second: "U",
      secondDE: 12.5,
    };

    const out = formatReport(scoreRead(a.join(""), SOLVED), diags);
    expect(out).toContain("kept 5% (ВЫБИТА), ΔE R 8.0 / L 26.5, отрыв 18.5");
    expect(out).toContain("kept 80%, ΔE B 11.0 / U 12.5, отрыв 1.5");
    // Ячейка с kept 80% не выбита — метка только у первой.
    expect(out.match(/ВЫБИТА/g)).toHaveLength(1);
  });

  it("сводка считает выбитые ячейки и ячейки без отрыва по всем 54", () => {
    const diags: CellDiag[] = Array.from({ length: 54 }, (_, i) => ({
      rgb: [200, 200, 200] as [number, number, number],
      kept: i < 4 ? 0.1 : 0.9, // 4 выбиты пересветом
      best: "U",
      bestDE: 3,
      second: "D",
      secondDE: i < 7 ? 3.5 : 40, // 7 без отрыва (config.STICKER_MARGIN_MIN)
    }));
    const out = formatReport(scoreRead(SOLVED, SOLVED), diags);
    expect(out).toContain(
      `выбитых пересветом (kept < ${(config.CELL_MIN_KEPT_FRAC * 100).toFixed(0)}%): 4`,
    );
    expect(out).toContain(`без отрыва от второго кандидата (< ${config.STICKER_MARGIN_MIN}): 7`);
  });

  // Живой отказ: ячейка ровная (kept 100%), а до БЛИЖАЙШЕГО эталона 33 — цвет не
  // принадлежит кубику вообще, argmin выбирает наименее далёкий и врёт. Такую
  // ячейку нельзя путать со «спутал похожие цвета»: лечится она не порогами.
  it("помечает ячейку, не похожую ни на один цвет кубика, и считает их в сводке", () => {
    const a = SOLVED.split("");
    a[0] = "R";
    const diags: CellDiag[] = Array.from({ length: 54 }, (_, i) => ({
      rgb: i === 0 ? ([150, 110, 80] as [number, number, number]) : [235, 238, 236],
      kept: 1,
      best: i === 0 ? "R" : "U",
      bestDE: i === 0 ? config.STICKER_MAX_DELTA_E + 1 : 3,
      second: i === 0 ? "L" : "D",
      secondDE: i === 0 ? config.STICKER_MAX_DELTA_E + 4 : 40,
    }));

    const out = formatReport(scoreRead(a.join(""), SOLVED), diags);
    expect(out).toContain("RGB(150,110,80)");
    expect(out).toContain("(НЕ ЦВЕТ КУБИКА)");
    expect(out).toContain(
      `не похожих ни на один цвет кубика (ΔE > ${config.STICKER_MAX_DELTA_E}): 1`,
    );
    // Медиана берётся по всем 54, поэтому одна далёкая ячейка её не сдвигает.
    expect(out).toContain("медианный ΔE до ближайшего эталона: 3.0");
  });

  // Откат подгонки на рамку раньше был невидим: сетка резалась по жёлтому
  // прямоугольнику, и промахи выглядели как ошибка цвета. На монолитном кубике
  // это ожидаемый исход (щели между деталями — только тень, контраст мал), и без
  // этих строк отличить «слабая решётка» от «плохой свет» нельзя.
  it("печатает выигрыш подгонки, контраст щелей и число откатов на рамку", () => {
    const fits = [
      { gain: 6.2, used: true, gap: 21 },
      { gain: 5.1, used: true, gap: 19 },
      { gain: 0.4, used: false, gap: 3.2 },
      { gain: 0.1, used: false, gap: 2.8 },
      { gain: 4.0, used: true, gap: 17 },
      { gain: 3.3, used: true, gap: 15 },
    ];
    const out = formatReport(scoreRead(SOLVED, SOLVED), undefined, fits);
    expect(out).toContain(
      `U: выигрыш 6.20 (порог ${config.FACE_FIT_MIN_GAIN}), ПОДОГНАНА, контраст щелей 21.0`,
    );
    expect(out).toContain("F: выигрыш 0.40");
    expect(out).toContain("ОТКАТ НА РАМКУ, контраст щелей 3.2");
    expect(out).toContain("откатов на рамку: 2 из 6");
  });

  // Блок подгонки не должен появляться, когда телеметрии нет: пустой заголовок
  // читался бы как «подгонка не сработала».
  it("без телеметрии подгонки блок не печатается", () => {
    expect(formatReport(scoreRead(SOLVED, SOLVED))).not.toContain("Подгонка сетки");
  });

  // Скептик (LOW): «кожа в ячейках — следствие съехавшей сетки» была
  // недоказанной посылкой. Отчёт обязан давать число, а не декларацию.
  it("считает ячейки, чей цвет ближе к телесному тону, чем к любому эталону", () => {
    const diags: CellDiag[] = Array.from({ length: 54 }, () => ({
      rgb: [235, 238, 236] as [number, number, number], // здоровый белый
      kept: 1,
      best: "U",
      bestDE: 3,
      second: "D",
      secondDE: 40,
    }));
    // Ячейка 0: цвет — палец/ладонь в кадре (телесный тон), а не наклейка.
    diags[0] = {
      rgb: config.FACE_FIT_SKIN_RGB,
      kept: 1,
      best: "L",
      bestDE: 22,
      second: "R",
      secondDE: 26,
    };
    const out = formatReport(scoreRead(SOLVED, SOLVED), diags);
    expect(out).toContain("ближе к телесному тону, чем к эталону кубика: 1");
  });

  it("не считает здоровую наклейку телесной, даже если её ΔE до эталона не нулевой", () => {
    const diags: CellDiag[] = Array.from({ length: 54 }, () => ({
      rgb: [235, 238, 236] as [number, number, number],
      kept: 1,
      best: "U",
      bestDE: 3,
      second: "D",
      secondDE: 40,
    }));
    const out = formatReport(scoreRead(SOLVED, SOLVED), diags);
    expect(out).toContain("ближе к телесному тону, чем к эталону кубика: 0");
  });

  // Телеметрия шага 6: контраст границ и определённость фазы сетки — печатаются,
  // только если пришли (useCubeReader.ts их пока не заполняет — отдельная
  // задача), но формат уже проверен на будущее.
  it("печатает контраст границ и определённость фазы сетки, когда они пришли", () => {
    const fits = [
      { gain: 6.2, used: true, gap: 21, edge: 45, margin: 4.3, decided: true },
      { gain: 5.1, used: true, gap: 19, edge: 8, margin: 1.1, decided: false },
      { gain: 0.4, used: false, gap: 3.2 }, // старая форма без edge/margin/decided
      { gain: 0.1, used: false, gap: 2.8, edge: 30, margin: 5, decided: true },
      { gain: 4.0, used: true, gap: 17, edge: 40, margin: 3, decided: true },
      { gain: 3.3, used: true, gap: 15, edge: 35, margin: 2.5, decided: true },
    ];
    const out = formatReport(scoreRead(SOLVED, SOLVED), undefined, fits);
    expect(out).toContain("контраст границ 45.0");
    expect(out).toContain("фаза сетки определена");
    expect(out).toContain("фаза сетки НЕ определена");
    expect(out).toContain("граней без определённой подгонки: 1 из 6");
  });

  it("без decided в телеметрии строку про определённость фазы не печатает", () => {
    const fits = [
      { gain: 6.2, used: true, gap: 21 },
      { gain: 5.1, used: true, gap: 19 },
      { gain: 0.4, used: false, gap: 3.2 },
      { gain: 0.1, used: false, gap: 2.8 },
      { gain: 4.0, used: true, gap: 17 },
      { gain: 3.3, used: true, gap: 15 },
    ];
    const out = formatReport(scoreRead(SOLVED, SOLVED), undefined, fits);
    expect(out).not.toContain("граней без определённой подгонки");
    expect(out).not.toContain("контраст границ");
  });
});

describe("formatRawGrids", () => {
  const grid = (letters: string): string[] => letters.split("");
  const cleanDiag = (best: string): CellDiag => ({
    rgb: [200, 200, 200] as [number, number, number],
    kept: 0.9,
    best,
    bestDE: 3,
    second: "D",
    secondDE: 40,
  });

  it("печатает шесть съёмок по три ряда, центр — в скобках", () => {
    const grids = [
      grid("UUUUUUUUU"),
      grid("RRRRRRRRR"),
      grid("FFFFFFFFF"),
      grid("DDDDDDDDD"),
      grid("LLLLLLLLL"),
      grid("BBBBBBBBB"),
    ];
    const out = formatRawGrids(grids);
    expect(out).toContain("(U)");
    expect(out).toContain("(B)");
    expect(out.split("\n")).toHaveLength(7); // заголовок + шесть съёмок
    expect(out).toContain("6: ");
  });

  // Сдвиг сетки и показанная дважды грань дают раскладке одинаковый отказ, а
  // лечатся противоположно. Разводит их только грань целиком: у сдвига ряды
  // разноцветные, у дубликата — честная грань, просто не та.
  it("показывает ряды целиком, а не один центр", () => {
    const grids = [
      grid("UURFFDLLB"),
      grid("RRRRRRRRR"),
      grid("FFFFFFFFF"),
      grid("DDDDDDDDD"),
      grid("LLLLLLLLL"),
      grid("BBBBBBBBB"),
    ];
    const out = formatRawGrids(grids);
    // Строку ищем по номеру съёмки, а не по позиции: перед ячейками может стоять
    // строка баланса цветов, и она стоит там именно тогда, когда чтение битое.
    const first = out.split("\n").find((l) => l.trim().startsWith("1:"))!;
    expect(first).toContain("U");
    expect(first).toContain("R");
    expect(first).toContain("(F)");
    expect(first).toContain("B");
  });

  it("ячейку, далёкую от всех эталонов, печатает строчной буквой", () => {
    const grids = [grid("UUUUUUUUU")];
    const diags = Array.from({ length: 9 }, () => cleanDiag("U"));
    diags[0] = { ...cleanDiag("U"), bestDE: config.STICKER_MAX_DELTA_E + 1 };
    const out = formatRawGrids(grids, diags);
    expect(out).toContain("u"); // выбившаяся ячейка
    expect(out).toContain("(U)"); // центр остался нормальным
  });

  it("к каждой съёмке приписывает ΔE центра, худшую ячейку и число выбитых бликом", () => {
    const grids = [grid("UUUUUUUUU")];
    const diags = Array.from({ length: 9 }, () => cleanDiag("U"));
    diags[4] = { ...cleanDiag("U"), bestDE: 12.5 };
    diags[7] = { ...cleanDiag("U"), bestDE: 21.25 };
    diags[8] = { ...cleanDiag("U"), kept: config.CELL_MIN_KEPT_FRAC / 2 };
    const out = formatRawGrids(grids, diags);
    expect(out).toContain("центр ΔE 12.5");
    expect(out).toContain("макс по ячейкам 21.3");
    expect(out).toContain("выбито бликом 1");
  });

  it("без диагностики печатает только буквы — ни ΔE, ни бликов", () => {
    const out = formatRawGrids([grid("UUUUUUUUU")]);
    expect(out).not.toContain("центр ΔE");
    expect(out).not.toContain("выбито бликом");
  });
});

describe("colorBalanceRu", () => {
  const g = (s: string): string[] => s.split("");

  it("у физически возможного чтения молчит", () => {
    const grids = ["U", "R", "F", "D", "L", "B"].map((c) => g(c.repeat(9)));
    expect(colorBalanceRu(grids)).toBeNull();
  });

  // Числа живого прогона 2026-08-19: отказ говорил про повороты граней, а на
  // самом деле четыре красных прочитаны не красными — это R1, главный риск.
  it("называет недостающий цвет, когда чтение невозможно", () => {
    const grids = [
      g("LDDLUULUU"),
      g("LLDBRRBDF"),
      g("UUULFBFUF"),
      g("RFDDDRDBB"),
      g("DFUFLFLLL"),
      g("BRBUBLLUU"),
    ];
    const out = colorBalanceRu(grids)!;
    expect(out).toContain("R 5");
    expect(out).toContain("L 12");
    expect(out).toContain("U 12");
    expect(out).toContain("недостаёт цвета R: 4");
  });

  it("дамп ячеек печатает баланс первой строкой", () => {
    const grids = [
      g("LDDLUULUU"),
      g("LLDBRRBDF"),
      g("UUULFBFUF"),
      g("RFDDDRDBB"),
      g("DFUFLFLLL"),
      g("BRBUBLLUU"),
    ];
    const out = formatRawGrids(grids);
    expect(out.split("\n")[0]).toContain("Баланс цветов");
  });

  it("у возможного чтения дамп начинается сразу с ячеек", () => {
    const grids = ["U", "R", "F", "D", "L", "B"].map((c) => g(c.repeat(9)));
    expect(formatRawGrids(grids).split("\n")[0]).toContain("Ячейки съёмок");
  });
});

describe("formatRawGrids — блик и сетка в одном месте", () => {
  const g = (s: string): string[] => s.split("");
  const diag = (kept: number): CellDiag => ({
    rgb: [200, 200, 200] as [number, number, number],
    kept,
    best: "U",
    bestDE: 3,
    second: "D",
    secondDE: 40,
  });

  // Блик на ПОЛОВИНЕ ячейки не дотягивает до CELL_MIN_KEPT_FRAC, счётчик
  // «выбито бликом» молчит — а цвет уже тянет к белому. Живой прогон
  // 2026-08-19: синего 6 из 9 при заведомо здоровых эталонах.
  it("печатает худшую ячейку по доле выживших пикселей", () => {
    const diags = Array.from({ length: 9 }, () => diag(0.9));
    diags[3] = diag(0.4); // блик съел больше половины, но флага нет
    const out = formatRawGrids([g("UUUUUUUUU")], diags);
    expect(out).toContain("худшая ячейка выжила на 40%");
    expect(out).not.toContain("выбито бликом");
  });

  it("прикладывает строку подгонки сетки, когда она передана", () => {
    const out = formatRawGrids([g("UUUUUUUUU")], undefined, [
      { gain: 5, used: true, gap: 0, edge: 41 },
    ]);
    expect(out).toContain("Сетка по съёмкам");
    expect(out).toContain("0/41");
  });

  it("без подгонки строку про сетку не выдумывает", () => {
    expect(formatRawGrids([g("UUUUUUUUU")])).not.toContain("Сетка по съёмкам");
  });
});

describe("concentratedMismatchRu — почерк «спорит не зрение»", () => {
  const clean = (best: string, bestDE: number): CellDiag => ({
    rgb: [200, 200, 200] as [number, number, number],
    kept: 1,
    best,
    bestDE,
    second: "B",
    secondDE: bestDE + 18,
    skin: 0,
  });

  /** 54 диагностики, где перечисленным индексам задан свой ΔE. */
  function diagsWith(overrides: Record<number, number>): CellDiag[] {
    return Array.from({ length: 54 }, (_, i) => clean("U", overrides[i] ?? 2.5));
  }

  // Живая сессия 2026-08-20: чтение 49/54, все пять промахов на съёмке U,
  // ΔE у них 1.1 / 1.5 / 2.8 / 2.3 / 4.3 — то есть цвета сняты безупречно.
  it("узнаёт живой случай: пять промахов в одной съёмке с чистыми цветами", () => {
    const truth = SOLVED.split("");
    // Портим пять ячеек грани U в ЭТАЛОНЕ, чтение оставляем «правильным» —
    // ровно та ситуация: камера видит одно, бумага ждёт другого.
    for (const i of [0, 3, 6, 7, 8]) truth[i] = i === 8 ? "D" : "B";
    const rep = scoreRead(SOLVED, truth.join(""));
    const out = concentratedMismatchRu(
      rep.stickers.filter((s) => !s.correct),
      diagsWith({ 0: 1.1, 3: 1.5, 6: 2.8, 7: 2.3, 8: 4.3 }),
    );
    expect(out).toContain("все 5 промахов");
    expect(out).toContain("грань U");
    expect(out).toContain("не тот скрамбл");
  });

  it("молчит, когда промахи размазаны по кубику", () => {
    const truth = SOLVED.split("");
    // По одному промаху на четырёх разных гранях — это не почерк.
    for (const i of [0, 12, 21, 30]) truth[i] = truth[i] === "U" ? "B" : "U";
    const rep = scoreRead(SOLVED, truth.join(""));
    expect(
      concentratedMismatchRu(
        rep.stickers.filter((s) => !s.correct),
        diagsWith({}),
      ),
    ).toBeNull();
  });

  // Если цвета грязные — это как раз ошибка зрения, и утверждать обратное нельзя.
  it("молчит, когда цвета в той же съёмке сняты грязно", () => {
    const truth = SOLVED.split("");
    for (const i of [0, 3, 6, 7, 8]) truth[i] = "B";
    const rep = scoreRead(SOLVED, truth.join(""));
    expect(
      concentratedMismatchRu(
        rep.stickers.filter((s) => !s.correct),
        diagsWith({ 0: 21, 3: 19, 6: 24, 7: 18, 8: 30 }),
      ),
    ).toBeNull();
  });

  it("молчит на двух промахах: это шум, а не почерк", () => {
    const truth = SOLVED.split("");
    truth[0] = "B";
    truth[1] = "B";
    const rep = scoreRead(SOLVED, truth.join(""));
    expect(
      concentratedMismatchRu(
        rep.stickers.filter((s) => !s.correct),
        diagsWith({ 0: 1.2, 1: 1.4 }),
      ),
    ).toBeNull();
  });

  it("без диагностики ячеек ничего не утверждает", () => {
    const truth = SOLVED.split("");
    for (const i of [0, 3, 6, 7, 8]) truth[i] = "B";
    const rep = scoreRead(SOLVED, truth.join(""));
    expect(concentratedMismatchRu(rep.stickers.filter((s) => !s.correct))).toBeNull();
  });
});
