// Shared RU copy for camera-acquisition failures, mapped from CameraErrorKind.
// Used by both the solo ritual and the accuracy harness so the wording stays in
// one place.

import { cameraDeniedRu } from "./guide";
import type { CameraErrorKind } from "./hooks/useCamera";

export function cameraErrorRu(kind: CameraErrorKind): string {
  switch (kind) {
    case "not-found":
      return "Камера не найдена. Подключи камеру и попробуй снова.";
    case "in-use":
      return "Камера занята другим приложением. Закрой его и попробуй снова.";
    case "insecure":
      return "Камера работает только по https (или на localhost). Открой страницу по защищённому адресу.";
    case "unsupported":
      return "Этот браузер не умеет работать с камерой. Открой в свежем Chrome или Firefox.";
    case "denied":
    default:
      return cameraDeniedRu();
  }
}
