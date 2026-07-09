// CameraStage — the live camera surface for the solo screen (§6.1).
//
// Layout: a 16:9 rounded frame containing three stacked layers:
//   1. <video>        — the live feed, CSS-mirrored (scaleX(-1)) for a selfie view.
//   2. overlay canvas — absolutely positioned, sized to the video, drawn by
//      drawOverlay(); ALSO CSS-mirrored so its geometry lines up with the mirrored
//      video (Cyrillic labels are flipped back locally inside drawOverlay).
//   3. work canvas    — hidden, un-mirrored; reserved for Slice B (readFace pixel
//      sampling). Present now so the ref plumbing is stable across slices.
//
// This component is purely presentational: it renders the DOM and forwards the
// three element refs to the parent (SoloPage), which owns the camera/hands
// lifecycle and the per-frame loop. It holds no camera state itself.
//
// A REC chip shows the live state; neutral design-system tokens only (no CV
// jargon, no decorative gradients).

import type { RefObject } from "react";

interface CameraStageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  workRef: RefObject<HTMLCanvasElement | null>;
  /** True once the stream is live — toggles the REC chip. */
  live?: boolean;
}

export default function CameraStage({
  videoRef,
  overlayRef,
  workRef,
  live = false,
}: CameraStageProps) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-ink bg-surface-2">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full [transform:scaleX(-1)]"
      />
      {/* Hidden un-mirrored work canvas — reserved for Slice B pixel sampling. */}
      <canvas ref={workRef} aria-hidden className="hidden" />

      {live ? (
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-ink bg-surface/90 px-2.5 py-1">
          <span
            aria-hidden
            className="inline-block h-2 w-2 animate-pulse-soft rounded-full bg-live"
          />
          <span className="font-sans text-caption uppercase tracking-wide text-ink">REC</span>
        </div>
      ) : null}
    </div>
  );
}
