/**
 * 生成 PWA 图标（192 / 512 PNG），纯 Node 实现，不依赖图像库。
 * 用法：node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'web', 'public');
const SS = 4; // 超采样倍数

const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];
const GRAY = [203, 213, 225];
const RED = [220, 38, 38];

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / len));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function drawPixel(x, y) {
  // 坐标为 0..1 的归一化坐标
  if (!insideRoundRect(x, y, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  let color = BLUE;
  if (insideRoundRect(x, y, 0.2, 0.16, 0.8, 0.84, 0.06)) {
    color = WHITE;
    // 三条灰色横线
    const line = (y0) => y > y0 - 0.022 && y < y0 + 0.022 && x > 0.3 && x < 0.7;
    if (line(0.32) || line(0.43)) color = GRAY;
    if (y > 0.535 && y < 0.579 && x > 0.3 && x < 0.57) color = GRAY;
    // 红色对勾
    const d1 = distToSegment(x, y, 0.33, 0.68, 0.44, 0.79);
    const d2 = distToSegment(x, y, 0.44, 0.79, 0.68, 0.53);
    if (Math.min(d1, d2) < 0.035) color = RED;
  }
  return [color[0], color[1], color[2], 255];
}

function render(size) {
  const big = size * SS;
  const rgba = Buffer.alloc(big * big * 4);
  for (let py = 0; py < big; py += 1) {
    for (let px = 0; px < big; px += 1) {
      const [r, g, b, a] = drawPixel((px + 0.5) / big, (py + 0.5) / big);
      const offset = (py * big + px) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = a;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const offset = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          const alpha = rgba[offset + 3] / 255;
          r += rgba[offset] * alpha;
          g += rgba[offset + 1] * alpha;
          b += rgba[offset + 2] * alpha;
          a += alpha;
        }
      }
      const n = SS * SS;
      const outOffset = (y * size + x) * 4;
      const alpha = a / n;
      if (alpha > 0) {
        out[outOffset] = Math.round(r / a);
        out[outOffset + 1] = Math.round(g / a);
        out[outOffset + 2] = Math.round(b / a);
      }
      out[outOffset + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function toPng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, toPng(size, render(size)));
  console.log(`生成 ${file}`);
}
