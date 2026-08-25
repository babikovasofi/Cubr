// Дорога кубков (plan: cups-system) — горизонтально листаемая трасса, как в
// Brawl Stars: зарабатываешь кубки → двигаешься по линии → шесть узлов-рубежей
// соединены плитками-сегментами. Presentational — читает `user` из
// `useAuthStore`, без доп. запроса: `cups`, `cups_rank`, `cups_floor`,
// `cups_to_next` уже едут на GET /users/me.
//
// RANKS — только карта меток (name → RU-подпись + цвет + floor для дисплея)
// в порядке `backend/app/services/cups.py::CUPS_TIERS`. `floor` здесь —
// зеркало того же файла, используется ТОЛЬКО для подписи "от {n}" под
// соседними узлами; award-логику фронт не пересчитывает, пороги текущего
// рубежа всегда берём из user.cups_floor/cups_to_next.
//
// `variant="full"` (по умолчанию, экран /cups) — во всю ширину, авто-скролл
// к игроку при монтировании. `variant="teaser"` — компактная неполосная
// сводка для дашборда (без скролла).
//
// Трасса скроллится ГОРИЗОНТАЛЬНО внутри собственного контейнера
// (overflow-x-auto) — страница вбок не едет.
import { useEffect, useRef } from "react";
import { useAuthStore } from "../store/authStore";
import { useT } from "../i18n/t";

export const RANKS: {
  name: string;
  label: string;
  color: string;
  floor: number;
  whiteTile?: boolean;
}[] = [
  { name: "white", label: "Белый", color: "#ffffff", floor: 0, whiteTile: true },
  { name: "yellow", label: "Жёлтый", color: "var(--warning)", floor: 100 },
  { name: "green", label: "Зелёный", color: "var(--success)", floor: 300 },
  { name: "blue", label: "Синий", color: "var(--primary)", floor: 600 },
  { name: "orange", label: "Оранжевый", color: "var(--live)", floor: 1000 },
  { name: "red", label: "Красный", color: "var(--danger)", floor: 1500 },
];

const PAD = 110;
const SEGMENT_COUNT = RANKS.length - 1;

type CupsRoadVariant = "full" | "teaser";

interface CupsRoadProps {
  variant?: CupsRoadVariant;
}

/** Тёмные заливки узлов (кроме белого/жёлтого) — точки мотива 3×3 рисуем
 * полупрозрачным белым, иначе тонут в собственном цвете. */
const DARK_TILES = new Set(["green", "blue", "orange", "red"]);

function dotsBackground(reached: boolean, rankName: string): React.CSSProperties {
  if (!reached) {
    return {
      backgroundImage: "radial-gradient(#d8cfbd 1.3px, transparent 1.4px)",
      backgroundSize: "10px 10px",
    };
  }
  const dot = DARK_TILES.has(rankName) ? "rgba(255,255,255,.75)" : "#221e17";
  return {
    backgroundImage: `radial-gradient(${dot} 1.3px, transparent 1.4px)`,
    backgroundSize: "10px 10px",
  };
}

export default function CupsRoad({ variant = "full" }: CupsRoadProps) {
  const user = useAuthStore((s) => s.user);
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);

  const cups = user?.cups ?? 0;
  const cupsRank = user?.cups_rank ?? "white";
  const cupsFloor = user?.cups_floor ?? 0;
  const cupsToNext = user?.cups_to_next ?? null;

  const currentIndex = Math.max(
    0,
    RANKS.findIndex((r) => r.name === cupsRank),
  );
  const atMax = cupsToNext === null;
  const fractionWithinRank = atMax
    ? 1
    : Math.min(1, Math.max(0, (cups - cupsFloor) / (cups + cupsToNext - cupsFloor)));
  const t01 = (currentIndex + fractionWithinRank) / SEGMENT_COUNT;

  const full = variant === "full";
  const width = full ? 2000 : 1300;
  const height = full ? 240 : 200;
  const plateH = full ? 56 : 44;
  const nodeSize = full ? 66 : 52;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(1, t01 - 0.18));
    el.scrollLeft = (el.scrollWidth - el.clientWidth) * target;
  }, [t01]);

  if (!user) return null;

  const usableW = width - 2 * PAD;
  const stationX = (i: number) => PAD + (i / SEGMENT_COUNT) * usableW;
  const playerX = PAD + t01 * usableW;

  function segmentFill(i: number): number {
    if (currentIndex > i) return 1;
    if (currentIndex === i) return fractionWithinRank;
    return 0;
  }

  return (
    <div
      ref={scrollRef}
      className="w-full overflow-y-hidden overflow-x-auto rounded-xl bg-bg"
      role="group"
      aria-label={t("Дорога рангов")}
    >
      <div className="relative" style={{ width, height }}>
        {/* Сегменты между узлами. */}
        {RANKS.slice(0, -1).map((rank, i) => {
          const from = stationX(i);
          const to = stationX(i + 1);
          const fill = segmentFill(i);
          const next = RANKS[i + 1];
          return (
            <div
              key={`segment-${rank.name}`}
              className="absolute overflow-hidden rounded-[10px] border-2 border-ink bg-surface-2 shadow-sticker"
              style={{
                left: from,
                width: to - from,
                top: height / 2 - plateH / 2,
                height: plateH,
              }}
            >
              <div
                className="h-full"
                style={{
                  width: `${fill * 100}%`,
                  background: `linear-gradient(90deg, ${rank.color}, ${next.color})`,
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-1/2 border-t-4 border-dashed border-ink"
                style={{ opacity: 0.28 }}
              />
            </div>
          );
        })}

        {/* Узлы-рубежи. Узел центрирован на линии; подписи — ОТДЕЛЬНЫМ блоком
            ниже узла, чтобы не наезжать на пунктирную дорогу по центру. */}
        {RANKS.map((rank, i) => {
          const reached = i <= currentIndex;
          const x = stationX(i);
          return (
            <div key={rank.name}>
              <div
                className="absolute flex items-center justify-center rounded-tile"
                style={{
                  left: x,
                  top: height / 2,
                  transform: "translate(-50%, -50%)",
                  width: nodeSize,
                  height: nodeSize,
                  background: reached ? rank.color : "var(--surface-2)",
                  border: reached ? "2px solid var(--ink)" : "2px dashed #cdc3b0",
                  boxShadow: reached ? "3px 3px 0 var(--ink)" : undefined,
                }}
              >
                <span
                  aria-hidden
                  className="h-[70%] w-[70%] rounded-[8px]"
                  style={dotsBackground(reached, rank.name)}
                />
              </div>
              <div
                className="absolute flex flex-col items-center gap-0.5 text-center"
                style={{
                  left: x,
                  top: height / 2 + nodeSize / 2 + 10,
                  transform: "translateX(-50%)",
                }}
              >
                <span
                  className="whitespace-nowrap font-sans text-small font-black"
                  style={{ color: reached ? "var(--ink)" : "#a89e8c" }}
                >
                  {t(rank.label)}
                </span>
                <span
                  className="whitespace-nowrap font-sans text-caption font-extrabold"
                  style={{ color: "#a89e8c" }}
                >
                  {t("от {n}", { n: rank.floor })}
                </span>
              </div>
            </div>
          );
        })}

        {/* «ты здесь» — единственный поворачивающийся элемент. */}
        <span
          className="absolute whitespace-nowrap rounded-md border-2 border-ink bg-primary px-3 py-1.5 font-sans text-[14px] font-black text-white shadow-sticker"
          style={{
            left: playerX,
            top: height / 2,
            transform: "translate(-50%, -115%) rotate(-5deg)",
          }}
        >
          {t("ты здесь · {n}", { n: cups })}
        </span>
      </div>
    </div>
  );
}
