// Ужать выбранное фото до маленького квадрата и вернуть data-URL (JPEG).
// Аватар хранится строкой в avatar_url (см. backend User.avatar_url = Text),
// поэтому загруженный файл кладём как компактный data-URL, а не грузим на
// сторонний хостинг. Квадрат по центру (cover), сторона `size` px, качество
// 0.72 — типично несколько КБ, влезает в лимит схемы (256 КБ).
export function downscaleImage(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("not an image"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("no 2d context"));
          return;
        }
        // Cover-обрезка по центру: берём меньшую сторону как квадрат-источник.
        const src = Math.min(img.width, img.height);
        const sx = (img.width - src) / 2;
        const sy = (img.height - src) / 2;
        ctx.drawImage(img, sx, sy, src, src, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("draw failed"));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}
