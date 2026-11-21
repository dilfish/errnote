/**
 * 造数据：5000 道文字题 + 200 张图片，用于性能自测。
 * 默认写到 ./.seed-data，不动真实数据；可 ERRNOTE_DATA=/some/dir 覆盖。
 * 用法：npm run seed:load
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb, ProblemRepo } from '../server/db.ts';
import { dataDir, ensureDataDirs } from '../server/paths.ts';
import { saveImageDataUrl } from '../server/images.ts';

const TEXT_COUNT = Number(process.env.SEED_TEXT ?? 5000);
const IMAGE_COUNT = Number(process.env.SEED_IMAGES ?? 200);

if (!process.env.ERRNOTE_DATA) {
  process.env.ERRNOTE_DATA = path.resolve(import.meta.dirname, '..', '.seed-data');
}

const subjects = ['数学', '语文', '英语', '物理', '化学'];
const points = ['分数加减', '一元一次方程', 'be 动词', '现在完成时', '电路欧姆定律', '化学方程式'];
const grades = ['三年级', '四年级', '五年级', '初一', '初二', '初三'];

// 1x1 白色 JPEG，足够用来测试图片存取和渲染链路
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function dirSize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    total += stat.isDirectory() ? dirSize(file) : stat.size;
  }
  return total;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

ensureDataDirs();
const db = openDb(path.join(dataDir(), 'errnote.db'));
const repo = new ProblemRepo(db);

const started = Date.now();
const existing = repo.count();
if (existing > 0) {
  console.log(`目标目录已有 ${existing} 道题，继续追加。目录：${dataDir()}`);
}

db.exec('BEGIN');
try {
  for (let i = 0; i < TEXT_COUNT; i += 1) {
    repo.create({
      subject: subjects[i % subjects.length],
      grade: grades[i % grades.length],
      stem: `第 ${i + 1} 题：已知 x = ${i}，求 ${i % 7} x + ${i % 5} 的值。`,
      options: [
        { key: 'A', text: String((i % 7) * i + (i % 5)) },
        { key: 'B', text: String((i % 7) * i) },
        { key: 'C', text: '以上都不对' },
      ],
      answer: `A`,
      analysis: `代入 x = ${i}，得到 ${(i % 7) * i + (i % 5)}。`,
      knowledgePoints: [points[i % points.length]],
      source: 'seed',
    });
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const insertMs = Date.now() - started;

const imageStarted = Date.now();
const paths: string[] = [];
for (let i = 0; i < IMAGE_COUNT; i += 1) {
  paths.push(saveImageDataUrl(TINY_JPEG));
}
for (let i = 0; i < paths.length; i += 1) {
  repo.create(
    {
      subject: subjects[i % subjects.length],
      grade: grades[i % grades.length],
      stem: `带图题 ${i + 1}：见图片。`,
      answer: 'B',
      analysis: '看图作答。',
      knowledgePoints: [points[i % points.length]],
      imagePath: paths[i],
      source: 'seed',
    },
    { source: 'seed' },
  );
}
const imageMs = Date.now() - imageStarted;

const listStart = Date.now();
const page = repo.list({ limit: 20 });
const listMs = Date.now() - listStart;

const searchStart = Date.now();
const searched = repo.list({ limit: 20, knowledgePoint: points[0] });
const searchMs = Date.now() - searchStart;

console.log('');
console.log(`数据目录      ${dataDir()}`);
console.log(`总条数        ${repo.count()}（其中带图 ${repo.countImages()}）`);
console.log(`插入耗时      ${TEXT_COUNT} 道文字题 ${insertMs} ms / ${IMAGE_COUNT} 张图 ${imageMs} ms`);
console.log(`列表查询      ${listMs} ms（返回 ${page.items.length} 条）`);
console.log(`知识点筛选    ${searchMs} ms（命中 ${searched.total} 条）`);
console.log(`目录体积      ${mb(dirSize(dataDir()))}`);
console.log('');
db.close();
