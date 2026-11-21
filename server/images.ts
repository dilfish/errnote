import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDataDirs, imagesDir } from './paths.ts';

export class ImageError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'IMAGE_INVALID') {
    super(message);
    this.name = 'ImageError';
    this.status = status;
    this.code = code;
  }
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const MAX_BYTES = 2 * 1024 * 1024;

export function isImagePath(value: string): boolean {
  return /^\/images\/[A-Za-z0-9._-]+$/.test(value);
}

/** 保存前端上传的 data URL，返回 /images/xxx.jpg */
export function saveImageDataUrl(dataUrl: string): string {
  const matched = dataUrl.match(/^data:(image\/[a-zA-Z]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!matched) throw new ImageError('图片格式不支持，请上传 jpg / png / webp');
  const ext = MIME_EXT[matched[1].toLowerCase()];
  if (!ext) throw new ImageError('图片格式不支持，请上传 jpg / png / webp');
  const buffer = Buffer.from(matched[2], 'base64');
  if (buffer.length === 0) throw new ImageError('图片内容为空');
  if (buffer.length > MAX_BYTES) {
    throw new ImageError('图片太大：请在网页里上传（页面会自动压缩到 1280px 以内）', 413, 'IMAGE_TOO_LARGE');
  }
  ensureDataDirs();
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(imagesDir(), name), buffer);
  return `/images/${name}`;
}

/** 把已保存的图片读成 data URL，供视觉模型使用 */
export function readImageAsDataUrl(relPath: string): string {
  if (!isImagePath(relPath)) throw new ImageError('图片路径非法');
  const name = relPath.replace('/images/', '');
  const ext = path.extname(name).slice(1).toLowerCase();
  const mime = EXT_MIME[ext];
  if (!mime) throw new ImageError('图片格式不支持');
  const file = path.join(imagesDir(), name);
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    throw new ImageError('图片不存在，可能已被删除', 404, 'IMAGE_NOT_FOUND');
  }
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export function imageFilePath(relPath: string): string | null {
  if (!isImagePath(relPath)) return null;
  const file = path.join(imagesDir(), relPath.replace('/images/', ''));
  return fs.existsSync(file) ? file : null;
}
