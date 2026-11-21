/**
 * 生成一批「数学」假数据，用于试用错题练习的周视图。
 *
 * 时间范围：今年 11 月 7 日 00:00 到现在（按本机时区）
 * 错误次数：0 / 1 / 2 次轮流分配；错误时间都落在「录入之后」到现在之间
 * 数据来源统一标记为 source = 假数据，方便一键清掉
 *
 * 用法：
 *   npm run seed:math              # 追加 90 道数学题
 *   npm run seed:math -- --count=60
 *   npm run seed:math -- --clear   # 只删除假数据，不动自己录的
 */
import { openDb, ProblemRepo } from '../server/db.ts';
import { dbFile, ensureDataDirs } from '../server/paths.ts';

const SOURCE = '假数据';
const args = process.argv.slice(2);
const clearOnly = args.includes('--clear');
const countArg = args.find((arg) => arg.startsWith('--count='));
const TOTAL = countArg ? Math.max(3, Number(countArg.split('=')[1]) || 90) : 90;

const GRADES = ['三年级', '四年级', '五年级', '六年级'];
const UNITS = ['第一单元', '第二单元', '第三单元', '第四单元', '第五单元', '第六单元', '第七单元', '第八单元'];
const SEMESTERS = ['上学期', '下学期'];

let seed = Number(process.env.SEED ?? Date.now() % 100000);
function random(): number {
  // 固定种子的伪随机，方便复现
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(list: T[]): T {
  return list[Math.floor(random() * list.length)];
}
function int(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type Item = {
  stem: string;
  answer: string;
  analysis: string;
  knowledgePoints: string[];
  problemType: string;
};

/** 题库池：口算 + 混合运算 + 简单应用题，足够抽 90 道不重复 */
function mathPool(): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  const add = (item: Item) => {
    if (seen.has(item.stem)) return;
    seen.add(item.stem);
    items.push(item);
  };

  for (let i = 0; i < 6000 && items.length < 600; i += 1) {
    switch (i % 6) {
      case 0: {
        const a = int(15, 89);
        const b = int(11, 99);
        add({
          stem: `计算：${a} + ${b} =`,
          answer: String(a + b),
          analysis: `${a} + ${b} = ${a + b}。`,
          knowledgePoints: ['两位数加法', '进位加法'],
          problemType: '计算题',
        });
        break;
      }
      case 1: {
        const a = int(50, 200);
        const b = int(10, 49);
        add({
          stem: `计算：${a} - ${b} =`,
          answer: String(a - b),
          analysis: `${a} - ${b} = ${a - b}。`,
          knowledgePoints: ['两位数减法', '退位减法'],
          problemType: '计算题',
        });
        break;
      }
      case 2: {
        const a = int(12, 99);
        const b = int(2, 9);
        add({
          stem: `计算：${a} × ${b} =`,
          answer: String(a * b),
          analysis: `${a} × ${b} = ${a * b}。`,
          knowledgePoints: ['多位数乘一位数'],
          problemType: '计算题',
        });
        break;
      }
      case 3: {
        const b = int(2, 9);
        const q = int(11, 99);
        add({
          stem: `计算：${b * q} ÷ ${b} =`,
          answer: String(q),
          analysis: `${b * q} ÷ ${b} = ${q}。`,
          knowledgePoints: ['除法竖式'],
          problemType: '计算题',
        });
        break;
      }
      case 4: {
        const a = int(2, 9);
        const b = int(2, 9);
        const c = int(10, 99);
        add({
          stem: `计算：${c} + ${a} × ${b} =`,
          answer: String(c + a * b),
          analysis: `先算乘法：${a} × ${b} = ${a * b}，再算加法：${c} + ${a * b} = ${c + a * b}。`,
          knowledgePoints: ['混合运算顺序'],
          problemType: '计算题',
        });
        break;
      }
      default: {
        const price = int(3, 15);
        const count = int(2, 9);
        add({
          stem: `一支铅笔 ${price} 元，买 ${count} 支一共要多少元？`,
          answer: `${price * count} 元`,
          analysis: `${price} × ${count} = ${price * count}（元）。`,
          knowledgePoints: ['单价×数量＝总价'],
          problemType: '应用题',
        });
      }
    }
  }
  return items;
}

ensureDataDirs();
const db = openDb(dbFile());
const repo = new ProblemRepo(db);

if (clearOnly) {
  const result = db.prepare('DELETE FROM problems WHERE source = ?').run(SOURCE);
  console.log(`已删除假数据 ${Number(result.changes)} 道，剩余 ${repo.count()} 道。`);
  db.close();
  process.exit(0);
}

const now = new Date();
const start = new Date(now.getFullYear(), 10, 7, 0, 0, 0);
// 如果当前时间还不到 11 月 7 日，就退回到去年
if (start.getTime() > now.getTime()) start.setFullYear(start.getFullYear() - 1);

const pool = shuffle(mathPool()).slice(0, TOTAL);
const startMs = start.getTime();
const nowMs = now.getTime();

for (const [index, item] of pool.entries()) {
  // 录入时间均匀落在 11 月 7 日 00:00 到现在
  const createdMs = startMs + Math.floor(random() * Math.max(1, nowMs - startMs));
  const createdAt = new Date(createdMs).toISOString();
  // 0 / 1 / 2 次轮流分配，保证三种次数都有
  const wrongCount = index % 3;
  const wrongTimes: string[] = [];
  const span = Math.max(nowMs - createdMs, 60 * 1000);
  for (let i = 0; i < wrongCount; i += 1) {
    wrongTimes.push(new Date(createdMs + Math.floor(random() * span)).toISOString());
  }
  wrongTimes.sort();
  repo.importDraft({
    subject: '数学',
    grade: pick(GRADES),
    unit: pick(UNITS),
    semester: pick(SEMESTERS),
    problemType: item.problemType,
    stem: item.stem,
    options: [],
    answer: item.answer,
    analysis: item.analysis,
    knowledgePoints: item.knowledgePoints,
    source: SOURCE,
    imagePath: null,
    createdAt,
    wrongCount,
    wrongTimes,
    mastered: false,
  });
}

const subjects = repo.subjects().map((item) => `${item.subject} ${item.n}`).join('，');
const zero = db.prepare("SELECT COUNT(*) AS n FROM problems WHERE source = ? AND wrong_count = 0").get(SOURCE) as {
  n: number;
};
const one = db.prepare("SELECT COUNT(*) AS n FROM problems WHERE source = ? AND wrong_count = 1").get(SOURCE) as {
  n: number;
};
const two = db.prepare("SELECT COUNT(*) AS n FROM problems WHERE source = ? AND wrong_count = 2").get(SOURCE) as {
  n: number;
};
const pad = (value: number) => String(value).padStart(2, '0');
const startText = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} 00:00`;
const endText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
console.log('');
console.log(`已追加假数据 ${pool.length} 道（来源 = ${SOURCE}，学科 = 数学）`);
console.log(`次数分布：0 次 ${Number(zero.n)} 道 · 1 次 ${Number(one.n)} 道 · 2 次 ${Number(two.n)} 道`);
console.log(`日期范围：${startText} ~ ${endText}（本机时区）`);
console.log(`当前题库：${repo.count()} 道（${subjects}）`);
console.log('想删掉假数据：npm run seed:math -- --clear');
console.log('');
db.close();
