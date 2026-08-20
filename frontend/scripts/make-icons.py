#!/usr/bin/env python3
"""Иконки сайта: грань кубика в палитре Cubr.

Зачем скрипт, а не «нарисовали один раз и положили». Иконка выводится из тех же
токенов, что и весь интерфейс (`src/index.css`), и живёт в шести размерах. Когда
палитра поедет, PNG-файлы должны поехать за ней — иначе через полгода никто не
вспомнит, из чего они собраны, и в репозитории останутся картинки-сироты.

Растр пишется вручную (zlib + struct), потому что в окружении нет ни PIL, ни
rsvg, ни ImageMagick, а тянуть зависимость ради шести плоских квадратов —
дороже, чем сорок строк кодировщика. Сглаживание — суперсэмплингом ×4: рисуем
крупно, усредняем. Для плоских фигур этого достаточно.

Запуск:  python3 scripts/make-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# Палитра — из src/index.css (светлая тема) плюс классический оранжевый кубика,
# которого в токенах интерфейса нет: там нет поверхности, где он бы понадобился.
INK = (0x22, 0x1E, 0x17)
WHITE = (0xFB, 0xF8, 0xF1)
RED = (0xC4, 0x1E, 0x3A)
BLUE = (0x00, 0x51, 0xBA)
GREEN = (0x00, 0x9E, 0x60)
YELLOW = (0xFF, 0xCF, 0x00)
ORANGE = (0xFF, 0x58, 0x00)

# Раскладка граней. Не собранная: собранная грань — одноцветный квадрат, по
# которому не понять, что это кубик. Разноцветная читается как кубик даже в 16px.
FACE = [
    [RED, WHITE, BLUE],
    [YELLOW, GREEN, ORANGE],
    [BLUE, ORANGE, WHITE],
]

SS = 4  # суперсэмплинг


def rounded_square(x: float, y: float, size: float, radius: float) -> object:
    """Замыкание «точка внутри скруглённого квадрата» — дешевле, чем растеризатор."""

    def inside(px: float, py: float) -> bool:
        dx = min(px - x, x + size - px)
        dy = min(py - y, y + size - py)
        if dx < 0 or dy < 0:
            return False
        if dx >= radius or dy >= radius:
            return True
        return (radius - dx) ** 2 + (radius - dy) ** 2 <= radius * radius

    return inside


def render(size: int) -> bytearray:
    """RGBA-буфер иконки заданного размера."""
    big = size * SS
    # Геометрия в долях стороны — чтобы иконка выглядела одинаково в 16 и в 512.
    pad = big * 0.06  # поле вокруг корпуса
    body = big - 2 * pad
    body_r = body * 0.22
    gap = body * 0.055  # шов между наклейками
    border = body * 0.085  # рамка корпуса вокруг сетки
    cell = (body - 2 * border - 2 * gap) / 3
    cell_r = cell * 0.24

    in_body = rounded_square(pad, pad, body, body_r)
    cells = []
    for r in range(3):
        for c in range(3):
            cx = pad + border + c * (cell + gap)
            cy = pad + border + r * (cell + gap)
            cells.append((rounded_square(cx, cy, cell, cell_r), FACE[r][c]))

    # Накапливаем в размере ×4, потом усредняем блоками SS×SS.
    acc = [[(0, 0, 0, 0)] * big for _ in range(big)]
    for yy in range(big):
        py = yy + 0.5
        row = acc[yy]
        for xx in range(big):
            px = xx + 0.5
            if not in_body(px, py):
                continue
            colour = INK
            for inside, sticker in cells:
                if inside(px, py):
                    colour = sticker
                    break
            row[xx] = (colour[0], colour[1], colour[2], 255)

    out = bytearray()
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                srow = acc[y * SS + sy]
                for sx in range(SS):
                    pr, pg, pb, pa = srow[x * SS + sx]
                    # Премультиплицируем: иначе прозрачные пиксели затянут цвет
                    # к чёрному по краям скругления.
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            n = SS * SS
            if a == 0:
                out += bytes((0, 0, 0, 0))
            else:
                out += bytes((round(r / a), round(g / a), round(b / a), round(a / n)))
    return out


def write_png(path: Path, size: int, rgba: bytearray) -> None:
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # фильтр строки: none
        raw += rgba[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def write_ico(path: Path, png_bytes: bytes, size: int) -> None:
    """ICO с PNG внутри — так умеют все браузеры, которым вообще нужен .ico."""
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack(
        "<BBBBHHII",
        size if size < 256 else 0,
        size if size < 256 else 0,
        0,
        0,
        1,
        32,
        len(png_bytes),
        6 + 16,
    )
    path.write_bytes(header + entry + png_bytes)


def main() -> None:
    public = Path(__file__).resolve().parent.parent / "public"
    public.mkdir(exist_ok=True)

    for size, name in [(32, "favicon-32.png"), (180, "apple-touch-icon.png"), (512, "icon-512.png")]:
        write_png(public / name, size, render(size))
        print("wrote", name)

    write_ico(public / "favicon.ico", (public / "favicon-32.png").read_bytes(), 32)
    print("wrote favicon.ico")


if __name__ == "__main__":
    main()
