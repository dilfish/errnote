export type CompressResult = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
};

async function loadBitmap(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 回退到 <img>
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('图片读取失败'));
  });
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

/** 把手机拍的原图压到长边 maxEdge、JPEG quality；超过 limit 就继续降质量/缩边 */
export async function compressImage(
  file: File,
  maxEdge = 1280,
  quality = 0.78,
  limit = 400 * 1024,
): Promise<CompressResult> {
  const loaded = await loadBitmap(file);
  try {
    let width = Math.max(1, Math.round(loaded.width * Math.min(1, maxEdge / Math.max(loaded.width, loaded.height))));
    let height = Math.max(1, Math.round(loaded.height * Math.min(1, maxEdge / Math.max(loaded.width, loaded.height))));

    const draw = (w: number, h: number, q: number): { dataUrl: string; bytes: number } => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器不支持 canvas');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(loaded.source, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      const base64 = dataUrl.split(',')[1] ?? '';
      return { dataUrl, bytes: Math.round((base64.length * 3) / 4) };
    };

    let current = draw(width, height, quality);
    let attempts = 0;
    while (current.bytes > limit && attempts < 6) {
      attempts += 1;
      if (quality > 0.45) {
        quality = Math.max(0.45, quality - 0.12);
      } else {
        width = Math.max(320, Math.round(width * 0.85));
        height = Math.max(320, Math.round(height * 0.85));
      }
      current = draw(width, height, quality);
    }
    return { dataUrl: current.dataUrl, width, height, bytes: current.bytes };
  } finally {
    loaded.release();
  }
}
