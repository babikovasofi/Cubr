"""Shared numeric bounds for user-submitted values.

Why a module and not four literals: the same ceiling has to hold on every
path that writes a solve time, and the four schemas that accept one
(`solve`, `duel`, `tournament`, `daily`) live far apart. A bound copied four
times is a bound that will be raised in three places and forgotten in the
fourth.
"""

# Верхняя граница времени сборки, миллисекунды.
#
# Ставится НЕ из продуктовых соображений («столько никто не собирает»), а
# потому что колонка `time_ms` во всех четырёх таблицах — 32-битный signed
# INTEGER (потолок 2 147 483 647). Без границы pydantic пропускает любое
# положительное целое, и запись падает уже в драйвере: на REST-ручках это 500
# вместо 422, а в дуэли — исключение внутри `_finalize` ПОСЛЕ того, как фаза
# комнаты переведена в finished. Комната остаётся `active`, оба участника
# остаются `active`, partial-UNIQUE больше не даёт создать новую, и оба игрока
# заперты навсегда (ручки удаления комнаты нет). То есть один кадр
# `{"type":"finish","time_ms":3000000000}` — это перманентный отказ в
# обслуживании себе и сопернику.
#
# Двадцать четыре часа: заведомо больше любой мыслимой сборки, включая
# многочасовые попытки вслепую и марафоны, и на два порядка ниже потолка
# INTEGER — запас на будущие суммы и разности внутри арифметики результата.
MAX_SOLVE_MS = 24 * 60 * 60 * 1000
