// Renders a cube's stored colour profile as 6 swatches, in positional-face order
// U/R/F/D/L/B. The profile is Lab; lab2rgb converts each to an sRGB swatch.

import { lab2rgb } from "../vision/colors";
import { CUBE_FACES, type ColorProfile } from "../api/cubes";
import { useT } from "../i18n/t";

const FACE_LABEL: Record<string, string> = {
  U: "Верх",
  R: "Право",
  F: "Фронт",
  D: "Низ",
  L: "Лево",
  B: "Тыл",
};

function css([r, g, b]: [number, number, number]): string {
  return `rgb(${r} ${g} ${b})`;
}

export default function ColorPalette({
  profile,
  size = "sm",
}: {
  profile: ColorProfile;
  size?: "sm" | "md";
}) {
  const t = useT();
  const dim = size === "md" ? "h-8 w-8" : "h-5 w-5";
  return (
    <ul className="flex gap-1" aria-label={t("Цвет-профиль кубика")}>
      {CUBE_FACES.map((face) => {
        const lab = profile[face];
        const label = `${FACE_LABEL[face] ?? face}`;
        return (
          <li
            key={face}
            title={label}
            aria-label={label}
            className={`${dim} cursor-default rounded-sm border-2 border-ink`}
            style={{ backgroundColor: lab ? css(lab2rgb(lab)) : "transparent" }}
          />
        );
      })}
    </ul>
  );
}
