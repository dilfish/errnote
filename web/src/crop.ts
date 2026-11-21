/**
 * 把一张大图按 AI 给的 bbox 切成单题缩略图。
 * bbox 是 [x1,y1,x2,y2] 的相对比例（0~1），裁出来的图片只用于展示/存档。
 */

export type Box = [number, number, number, number];

export type CropOptions = { padding?: number; quality?: number };

/** 可复用的裁剪函数（图片只解码一次，几十道题也够快） */
export type Cropper = (rawBox: unknown, options?: CropOptions) => string | null;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 容错：0~1 / 0~100 / 0~1000 三种量纲都接受，写反的坐标自动交换 */
export function normalizeBox(raw: unknown): Box | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const numbers = raw.slice(0, 4).map((value) => (typeof value === 'string' ? Number(value) : value));
  if (!numbers.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) return null;
  const max = Math.max(...numbers.map(Math.abs));
  const scale = max <= 1 ? 1 : max <= 100 ? 100 : max <= 1000 ? 1000 : max;
  let [x1, y1, x2, y2] = numbers.map((value) => clamp01(value / scale)) as Box;
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  if (x2 - x1 < 0.02 || y2 - y1 < 0.02) return null;
  return [x1, y1, x2, y2];
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = source;
  });
}

function cropFromImage(image: HTMLImageElement, rawBox: unknown, options: CropOptions = {}): string | null {
  const box = normalizeBox(rawBox);
  if (!box) return null;
  const padding = options.padding ?? 0.02;
  const left = clamp01(box[0] - padding);
  const top = clamp01(box[1] - padding);
  const right = clamp01(box[2] + padding);
  const bottom = clamp01(box[3] + padding);
  // 框住几乎整张图就没必要再切了
  if ((right - left) * (bottom - top) > 0.95) return null;

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return null;

  const sx = Math.round(left * width);
  const sy = Math.round(top * height);
  const sw = Math.max(1, Math.round((right - left) * width));
  const sh = Math.max(1, Math.round((bottom - top) * height));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/jpeg', options.quality ?? 0.85);
}

/** 加载一次原图，返回按 bbox 裁剪的函数；图片读不出来时抛错，调用方回退原图 */
export async function createCropper(source: string): Promise<Cropper> {
  const image = await loadImage(source);
  return (rawBox, options) => cropFromImage(image, rawBox, options);
}

/** 单次裁剪（内部只加载一次图，批量场景请用 createCropper） */
export async function cropDataUrl(source: string, rawBox: unknown, options: CropOptions = {}): Promise<string | null> {
  const cropper = await createCropper(source);
  return cropper(rawBox, options);
}
