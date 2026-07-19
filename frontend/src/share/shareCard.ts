// Share/download for the result card (plan: result-share-card). Download is
// the always-available primary path; native share is progressive enhancement,
// gated by canShare({files}) — most desktop browsers don't implement file
// sharing, so it must never be the only way out.

export type ShareOutcome = "shared" | "downloaded";

export interface ShareMeta {
  title: string;
  text: string;
}

export function canShareFiles(file: File): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Delay the revoke: the browser needs a moment to pick up the download
  // request off the blob: URL before it's invalidated.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownload(
  blob: Blob,
  filename: string,
  meta: ShareMeta,
): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: "image/png" });

  // Feature-detect with the REAL built file, at click time (canShare's file-type
  // support can't be reliably probed ahead of time) — and call share() only
  // inside this click gesture, never deferred.
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: meta.title, text: meta.text });
    } catch (err) {
      // AbortError = user closed the native sheet — silent no-op, not a
      // fallback to download (that would surprise someone who just cancelled).
      if (err instanceof Error && err.name === "AbortError") return "shared";
      throw err;
    }
    return "shared";
  }

  download(blob, filename);
  return "downloaded";
}
