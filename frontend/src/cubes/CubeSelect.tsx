// Solo-lobby cube selector. Picks which registered cube a solve is attributed to
// (writes cubesStore.selectedCubeId, read at save time via getSelectedCubeId).
// Renders nothing when the user has no cubes (anonymous or not yet registered) —
// solo still works, the solve just carries cube_id: null.

import { useEffect } from "react";
import { useCubesStore } from "../store/cubesStore";
import { useT } from "../i18n/t";

export default function CubeSelect() {
  const t = useT();
  const list = useCubesStore((s) => s.list);
  const status = useCubesStore((s) => s.status);
  const load = useCubesStore((s) => s.load);
  const selectedCubeId = useCubesStore((s) => s.selectedCubeId);
  const setSelected = useCubesStore((s) => s.setSelected);

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  if (list.length === 0) return null;

  return (
    <label className="flex items-center gap-2 font-sans text-small text-muted">
      {t("Кубик:")}
      <select
        value={selectedCubeId ?? ""}
        onChange={(e) => setSelected(e.target.value || null)}
        className="h-9 rounded-md border-2 border-ink bg-surface px-2 font-sans text-small font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {list.map((cube) => (
          <option key={cube.id} value={cube.id}>
            {cube.name}
            {cube.is_primary ? ` ${t("(основной)")}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
