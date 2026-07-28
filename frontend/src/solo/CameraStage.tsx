// The live camera surface: a CSS-mirrored <video> with a matching CSS-mirrored
// overlay <canvas> on top, plus a hidden work-canvas for sampling. Mirroring is
// ONE convention (skeptic MED): only these two elements carry scaleX(-1); all
// sampling + overlay geometry stays in raw video coords, so a hand physically on
// the right lands in the right-hand zone.

import type { RefObject } from "react";
import { useT } from "../i18n/t";

interface CameraStageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  workRef: RefObject<HTMLCanvasElement | null>;
  error: string | null;
  onRetry?: () => void;
}

export default function CameraStage({
  videoRef,
  overlayRef,
  workRef,
  error,
  onRetry,
}: CameraStageProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video min-h-[16rem] w-full overflow-hidden rounded-lg border-2 border-ink bg-surface-2">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
          playsInline
          muted
        />
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100"
        />
        {error ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/90 p-6 text-center"
          >
            <p className="max-w-prose font-sans text-body text-danger">{error}</p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-primary px-4 font-sans text-small font-extrabold text-white"
              >
                {t("Попробовать снова")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <canvas ref={workRef} className="hidden" aria-hidden />
    </div>
  );
}
