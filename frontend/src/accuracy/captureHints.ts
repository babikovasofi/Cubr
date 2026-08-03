// Short per-step orientation hints: which face points at the camera and which
// ends up on top — named by CENTRE colour, no U/R/F/D/L/B jargon, so the tester
// doesn't need to know cube notation to follow along.
//
// Centre, not face. Чтения снимаются со СКРАМБЛИРОВАННОГО кубика: белой грани
// на нём нет вообще, у каждой грани все девять наклеек разные. Единственное, что
// делает грань «той самой», — её центр: центры не двигаются никакими ходами,
// поэтому «грань с белым центром» однозначно и на собранном, и на разобранном.
// Прежний текст («покажи БЕЛУЮ грань») был написан под калибровку, где кубик
// собран, и переехал сюда как есть — на скрамбле он отправлял искать грань,
// которой не существует.
//
// Geometry (verified two ways — physical "tip toward/away from viewer" + the
// standard whole-cube rotations x/x'): spinning around the vertical axis to
// show R/F/L/B keeps white on top unchanged. Showing U or D is a PIVOT, not a
// spin, and the two pivots go in OPPOSITE directions:
//   x'  (U to front): white->front, green->bottom, BLUE->top.
//   x   (D to front): yellow->front, white->bottom, GREEN->top.
// An earlier version of this copy had U/D's top-colour swapped, which fed the
// reader a mismatched orientation on exactly those two steps — the likely root
// cause of drift errors reported downstream (e.g. on L, right after D).
export const CAPTURE_HINTS: { face: string; ru: string }[] = [
  {
    face: "U",
    ru: "В камеру — грань с БЕЛЫМ центром. Наверху окажется центр синий, внизу зелёный.",
  },
  { face: "R", ru: "В камеру — грань с КРАСНЫМ центром. Наверху центр белый." },
  { face: "F", ru: "В камеру — грань с ЗЕЛЁНЫМ центром. Наверху центр белый." },
  {
    face: "D",
    ru: "В камеру — грань с ЖЁЛТЫМ центром. Наверху окажется центр зелёный, внизу белый.",
  },
  { face: "L", ru: "В камеру — грань с ОРАНЖЕВЫМ центром. Наверху центр белый." },
  { face: "B", ru: "В камеру — грань с СИНИМ центром. Наверху центр белый." },
];
