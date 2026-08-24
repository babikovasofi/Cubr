// Дорога кубков (plan: cups-system) — непрерывный петляющий путь, как в Brawl
// Stars, а не список строк-ступеней (owner: «сделай путь как в brawl stars, не
// ступенчатым путём»). Presentational — читает `user` из `useAuthStore`, без
// доп. запроса: `cups`, `cups_rank`, `cups_floor` уже едут на GET /users/me.
//
// RANKS — только карта меток (name → RU-подпись + акцент маркера) в порядке
// `backend/app/services/cups.py::CUPS_TIERS`. Пороги (пол/остаток) приходят с
// бэкенда и здесь не пересчитываются: только у ТЕКУЩЕГО ранга показываем пол,
// потому что только его порог известен клиенту.
//
// Отрисовка — один SVG: витая дорога (base-линия + залитый до текущего ранга
// участок через pathLength), узлы-кружки по рангам, текущий — крупнее, с
// обводкой ink и жёсткой тенью (момент «ты здесь»). Поворотов нет: раньше
// текущая ступень была строкой во всю ширину с rotate(-2deg) и «уезжала» за
// край — здесь маркер круглый, перекашиваться нечему.
import { useAuthStore } from "../store/authStore";
import { useT } from "../i18n/t";

export const RANKS: { name: string; label: string; accent: string; whiteTile?: boolean }[] = [
  { name: "white", label: "Белый", accent: "var(--white)", whiteTile: true },
  { name: "yellow", label: "Жёлтый", accent: "var(--warning)" },
  { name: "green", label: "Зелёный", accent: "var(--success)" },
  { name: "blue", label: "Синий", accent: "var(--primary)" },
  { name: "orange", label: "Оранжевый", accent: "var(--live)" },
  { name: "red", label: "Красный", accent: "var(--danger)" },
];

const W = 340;
const TOP = 60;
const STEP = 132;
const LEFT_X = 84;
const RIGHT_X = W - 84;

function nodeX(i: number): number {
  return i % 2 === 0 ? LEFT_X : RIGHT_X;
}
function nodeY(i: number): number {
  return TOP + i * STEP;
}

// Путь через центры всех узлов: между соседями — плавная S-кривая (control-
// точки на середине по вертикали), отсюда «змейка».
function roadPath(): string {
  let d = `M ${nodeX(0)} ${nodeY(0)}`;
  for (let i = 1; i < RANKS.length; i++) {
    const x0 = nodeX(i - 1);
    const x1 = nodeX(i);
    const my = (nodeY(i - 1) + nodeY(i)) / 2;
    d += ` C ${x0} ${my} ${x1} ${my} ${x1} ${nodeY(i)}`;
  }
  return d;
}

export default function CupsRoad() {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  if (!user) return null;

  const { cups_rank, cups_floor } = user;
  const currentIndex = Math.max(
    0,
    RANKS.findIndex((r) => r.name === cups_rank),
  );
  const passedPct = (currentIndex / (RANKS.length - 1)) * 100;
  const height = nodeY(RANKS.length - 1) + 56;
  const path = roadPath();

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      className="h-auto max-w-md"
      role="img"
      aria-label={t("Дорога рангов")}
    >
      <defs>
        <filter id="cups-sticker" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="3" dy="3" stdDeviation="0" floodColor="var(--ink)" floodOpacity="1" />
        </filter>
      </defs>

      {/* База дороги. */}
      <path
        d={path}
        fill="none"
        stroke="var(--surface-2)"
        strokeWidth={18}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Пройденный участок — заливка primary до текущего ранга. */}
      <path
        d={path}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={18}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        strokeDasharray={`${passedPct} 100`}
      />

      {RANKS.map((rank, i) => {
        const isCurrent = i === currentIndex;
        const isPast = i < currentIndex;
        const cx = nodeX(i);
        const cy = nodeY(i);
        const r = isCurrent ? 34 : 26;
        const fill = isPast || isCurrent ? rank.accent : "var(--surface)";
        return (
          <g key={rank.name}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={fill}
              stroke="var(--ink)"
              strokeWidth={isCurrent ? 3 : 2}
              filter={isCurrent ? "url(#cups-sticker)" : undefined}
            />
            {/* Белый ранг на кремовом фоне — внутренний контур, чтобы кружок читался. */}
            {rank.whiteTile ? (
              <circle
                cx={cx}
                cy={cy}
                r={r - 6}
                fill="none"
                stroke="var(--line)"
                strokeWidth={1.5}
              />
            ) : null}
            {isCurrent ? (
              <circle
                cx={cx}
                cy={cy}
                r={7}
                fill="var(--surface)"
                stroke="var(--ink)"
                strokeWidth={2}
              />
            ) : null}
            {/* Подпись ранга под узлом. */}
            <text
              x={cx}
              y={cy + r + 20}
              textAnchor="middle"
              fontFamily="system-ui, sans-serif"
              fontSize={16}
              fontWeight={isCurrent ? 800 : 700}
              fill="var(--ink)"
            >
              {t(rank.label)}
            </text>
            {isCurrent ? (
              <text
                x={cx}
                y={cy + r + 40}
                textAnchor="middle"
                fontFamily="system-ui, sans-serif"
                fontSize={13}
                fill="var(--muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t("ты здесь · от {n}", { n: cups_floor })}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
