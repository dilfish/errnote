import fs from 'node:fs';
import path from 'node:path';

/** 仓库根目录（运行 node server/index.ts 时的上一级） */
export const ROOT = path.resolve(import.meta.dirname, '..');

/** 数据目录：默认 ./data，可用 ERRNOTE_DATA 覆盖（测试会用到） */
export function dataDir(): string {
  return process.env.ERRNOTE_DATA ? path.resolve(process.env.ERRNOTE_DATA) : path.join(ROOT, 'data');
}

export function dbFile(): string {
  return path.join(dataDir(), 'errnote.db');
}

export function imagesDir(): string {
  return path.join(dataDir(), 'images');
}

export function configFile(): string {
  return path.join(dataDir(), 'config.json');
}

export function distDir(): string {
  return path.join(ROOT, 'web', 'dist');
}

export function ensureDataDirs(): void {
  fs.mkdirSync(imagesDir(), { recursive: true });
}
