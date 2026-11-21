/**
 * 生成示例错题（数学/语文/英语），日期随机分布在最近 120 天，用于试用页面。
 * 用法：
 *   npm run seed:demo            # 追加 45 道示例题到 data/
 *   npm run seed:demo -- --clear # 只删除示例题（source = 示例），不动自己录的
 *   npm run seed:demo -- --count=60
 */
import path from 'node:path';
import { openDb, ProblemRepo } from '../server/db.ts';
import { dbFile, ensureDataDirs } from '../server/paths.ts';
import type { ProblemOption } from '../server/model.ts';

const SOURCE = '示例';
const args = process.argv.slice(2);
const clearOnly = args.includes('--clear');
const countArg = args.find((arg) => arg.startsWith('--count='));
const TOTAL = countArg ? Math.max(3, Number(countArg.split('=')[1]) || 45) : 45;

const GRADES = ['三年级', '四年级', '五年级', '六年级'];

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
  subject: string;
  stem: string;
  options?: ProblemOption[];
  answer: string;
  analysis: string;
  knowledgePoints: string[];
};

function options(correct: string, wrongs: string[]): { options: ProblemOption[]; answer: string } {
  const letters = ['A', 'B', 'C', 'D'];
  const list = shuffle([correct, ...wrongs.slice(0, 3)]);
  const options = list.map((text, index) => ({ key: letters[index], text }));
  const answer = letters[list.indexOf(correct)];
  return { options, answer };
}

/* ---------------- 数学 ---------------- */

function mathItems(): Item[] {
  const items: Item[] = [];

  const a = int(12, 89);
  const b = int(11, 79);
  items.push({
    subject: '数学',
    stem: `计算：${a} + ${b} - ${Math.min(a, b) - 5} = ？`,
    answer: String(a + b - (Math.min(a, b) - 5)),
    analysis: `先算加法 ${a} + ${b} = ${a + b}，再减去 ${Math.min(a, b) - 5}，结果是 ${a + b - (Math.min(a, b) - 5)}。`,
    knowledgePoints: ['加减混合运算', '运算顺序'],
  });

  const d1 = int(2, 9);
  const n1 = int(1, d1 - 1);
  const n2 = int(1, d1 - n1);
  const num = n1 + n2;
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const g = gcd(num, d1);
  items.push({
    subject: '数学',
    stem: `计算：${n1}/${d1} + ${n2}/${d1} = ？（结果写成最简分数）`,
    answer: g === d1 ? `${num / g}` : `${num / g}/${d1 / g}`,
    analysis: `同分母分数相加，分母不变，分子相加：(${n1}+${n2})/${d1} = ${num}/${d1}${g > 1 ? `，约分后得 ${num / g}/${d1 / g}` : ''}。`,
    knowledgePoints: ['同分母分数加法', '约分'],
  });

  const length = int(6, 15);
  const width = int(3, length - 1);
  items.push({
    subject: '数学',
    stem: `一个长方形花坛，长 ${length} 米，宽 ${width} 米。它的周长是多少米？`,
    answer: `${(length + width) * 2} 米`,
    analysis: `长方形周长 =（长 + 宽）× 2 =（${length} + ${width}）× 2 = ${(length + width) * 2}（米）。`,
    knowledgePoints: ['长方形周长', '周长公式'],
  });

  const speed = int(40, 80);
  const hours = int(2, 5);
  items.push({
    subject: '数学',
    stem: `一辆汽车每小时行驶 ${speed} 千米，${hours} 小时能行驶多少千米？`,
    answer: `${speed * hours} 千米`,
    analysis: `路程 = 速度 × 时间 = ${speed} × ${hours} = ${speed * hours}（千米）。`,
    knowledgePoints: ['速度时间路程', '乘法应用题'],
  });

  const price = int(3, 12);
  const count = int(4, 9);
  const money = int(50, 100);
  items.push({
    subject: '数学',
    stem: `每本笔记本 ${price} 元，小明买了 ${count} 本，付了 ${money} 元，应找回多少元？`,
    answer: `${money - price * count} 元`,
    analysis: `先算总价：${price} × ${count} = ${price * count}（元），再算找零：${money} - ${price * count} = ${money - price * count}（元）。`,
    knowledgePoints: ['总价计算', '带余除法'],
  });

  const total = int(20, 60);
  const groups = int(3, 6);
  const per = Math.floor(total / groups);
  const rest = total - per * groups;
  items.push({
    subject: '数学',
    stem: `有 ${total} 个苹果，平均分给 ${groups} 个小朋友，每人分几个？还剩几个？`,
    answer: `每人 ${per} 个，还剩 ${rest} 个`,
    analysis: `${total} ÷ ${groups} = ${per} 余 ${rest}，所以每人 ${per} 个，还剩 ${rest} 个。`,
    knowledgePoints: ['有余数的除法', '平均分'],
  });

  const base = int(5, 12);
  const height = int(4, 10);
  const choice = options(`${base * height} 平方厘米`, [
    `${(base + height) * 2} 平方厘米`,
    `${base * height * 2} 平方厘米`,
    `${base + height} 平方厘米`,
  ]);
  items.push({
    subject: '数学',
    stem: `一个平行四边形的底是 ${base} 厘米，高是 ${height} 厘米，面积是多少？`,
    options: choice.options,
    answer: choice.answer,
    analysis: `平行四边形面积 = 底 × 高 = ${base} × ${height} = ${base * height}（平方厘米）。`,
    knowledgePoints: ['平行四边形面积', '面积公式'],
  });

  const scores = [int(70, 95), int(75, 99), int(80, 100), int(65, 92)];
  const sum = scores.reduce((x, y) => x + y, 0);
  items.push({
    subject: '数学',
    stem: `小明四次数学测验的成绩分别是 ${scores[0]}、${scores[1]}、${scores[2]}、${scores[3]} 分，平均分是多少？`,
    answer: `${(sum / 4).toFixed(1)} 分`,
    analysis: `平均数 = 总成绩 ÷ 次数 = (${scores.join(' + ')}) ÷ 4 = ${sum} ÷ 4 = ${(sum / 4).toFixed(1)}（分）。`,
    knowledgePoints: ['平均数', '除法应用'],
  });

  const x = int(3, 15);
  const k = int(2, 6);
  const c = int(4, 20);
  items.push({
    subject: '数学',
    stem: `解方程：${k}x + ${c} = ${k * x + c}，求 x。`,
    answer: `x = ${x}`,
    analysis: `两边同时减去 ${c}：${k}x = ${k * x}；再同时除以 ${k}，得 x = ${x}。`,
    knowledgePoints: ['解一元一次方程', '等式性质'],
  });

  const original = int(80, 200);
  const discount = pick([8, 9, 7.5]);
  const pay = Math.round(original * discount) / 10;
  items.push({
    subject: '数学',
    stem: `一件衣服原价 ${original} 元，现在打 ${discount} 折，现价是多少元？`,
    answer: `${pay} 元`,
    analysis: `${discount} 折就是原价的 ${discount / 10}，${original} × ${discount / 10} = ${pay}（元）。`,
    knowledgePoints: ['折扣问题', '百分数应用'],
  });

  return items;
}

/* ---------------- 语文 ---------------- */

function chineseItems(): Item[] {
  const items: Item[] = [];

  const words: { word: string; pinyin: string; wrong: string[] }[] = [
    { word: '的确', pinyin: 'dí què', wrong: ['de què', 'dì què'] },
    { word: '处理', pinyin: 'chǔ lǐ', wrong: ['chù lǐ', 'chū lǐ'] },
    { word: '学校', pinyin: 'xué xiào', wrong: ['xué xiāo', 'xüé xiào'] },
    { word: '音乐', pinyin: 'yīn yuè', wrong: ['yīn lè', 'yìn yuè'] },
  ];
  for (const item of words) {
    const choice = options(item.pinyin, item.wrong);
    items.push({
      subject: '语文',
      stem: `下列加点字读音完全正确的一项是：（「${item.word}」）`,
      options: choice.options,
      answer: choice.answer,
      analysis: `「${item.word}」的正确读音是 ${item.pinyin}，容易读错的是多音字部分。`,
      knowledgePoints: ['多音字', '字音辨析'],
    });
  }

  const idioms: { sentence: string; answer: string; wrong: string[]; why: string }[] = [
    {
      sentence: '他做事总是（ ），从不马虎。',
      answer: '一丝不苟',
      wrong: ['三心二意', '漫不经心', '囫囵吞枣'],
      why: '句子强调认真、不马虎，「一丝不苟」形容做事认真细致，一点不马虎。',
    },
    {
      sentence: '同学们（ ）地讨论着春游的事。',
      answer: '兴致勃勃',
      wrong: ['无精打采', '垂头丧气', '心灰意冷'],
      why: '讨论春游是开心的事，用「兴致勃勃」表示兴趣浓厚、情绪高涨。',
    },
    {
      sentence: '这道题他（ ），很快就做出来了。',
      answer: '轻而易举',
      wrong: ['千辛万苦', '费尽心机', '束手无策'],
      why: '「很快就做出来」说明很轻松，「轻而易举」形容事情容易做。',
    },
  ];
  for (const item of idioms) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '语文',
      stem: `选词填空：${item.sentence}`,
      options: choice.options,
      answer: choice.answer,
      analysis: item.why,
      knowledgePoints: ['成语运用', '词语辨析'],
    });
  }

  const poems: { line: string; next: string; title: string }[] = [
    { line: '床前明月光', next: '疑是地上霜', title: '《静夜思》' },
    { line: '两个黄鹂鸣翠柳', next: '一行白鹭上青天', title: '《绝句》' },
    { line: '锄禾日当午', next: '汗滴禾下土', title: '《悯农》' },
    { line: '远上寒山石径斜', next: '白云生处有人家', title: '《山行》' },
  ];
  for (const poem of poems) {
    const choice = options(
      poem.next,
      shuffle(['一行白鹭上青天', '疑是地上霜', '霜叶红于二月花', '春风吹又生']).filter((line) => line !== poem.next),
    );
    items.push({
      subject: '语文',
      stem: `默写填空：${poem.line}，________。（${poem.title}）`,
      options: choice.options,
      answer: choice.answer,
      analysis: `出自${poem.title}，下一句是「${poem.next}」。`,
      knowledgePoints: ['古诗默写', '课内积累'],
    });
  }

  const synonyms: { word: string; answer: string; wrong: string[] }[] = [
    { word: '高兴', answer: '愉快', wrong: ['难过', '生气', '着急'] },
    { word: '美丽', answer: '漂亮', wrong: ['丑陋', '难看', '普通'] },
    { word: '安静', answer: '宁静', wrong: ['热闹', '吵闹', '喧哗'] },
    { word: '宽阔', answer: '宽广', wrong: ['狭窄', '拥挤', '窄小'] },
  ];
  for (const item of synonyms) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '语文',
      stem: `「${item.word}」的近义词是：`,
      options: choice.options,
      answer: choice.answer,
      analysis: `「${item.answer}」和「${item.word}」意思相近，可以互换使用。`,
      knowledgePoints: ['近义词', '词语积累'],
    });
  }

  const sentences: { wrong: string; right: string; why: string }[] = [
    {
      wrong: '通过这次活动，使我明白了团结的重要。',
      right: '通过这次活动，我明白了团结的重要。',
      why: '「通过……使……」造成句子缺少主语，删掉「使」即可。',
    },
    {
      wrong: '我们要养成讲卫生的好风气。',
      right: '我们要养成讲卫生的好习惯。',
      why: '「养成」只能和「习惯」搭配，不能说「养成风气」。',
    },
    {
      wrong: '他的写作水平明显改进了。',
      right: '他的写作水平明显提高了。',
      why: '「水平」和「提高」搭配，「改进」多用于方法、技术。',
    },
  ];
  for (const item of sentences) {
    items.push({
      subject: '语文',
      stem: `修改病句：${item.wrong}`,
      answer: item.right,
      analysis: item.why,
      knowledgePoints: ['修改病句', '词语搭配'],
    });
  }

  return items;
}

/* ---------------- 英语 ---------------- */

function englishItems(): Item[] {
  const items: Item[] = [];

  const beVerbs: { subject: string; answer: string; wrong: string[] }[] = [
    { subject: 'I', answer: 'am', wrong: ['is', 'are'] },
    { subject: 'She', answer: 'is', wrong: ['am', 'are'] },
    { subject: 'They', answer: 'are', wrong: ['am', 'is'] },
    { subject: 'Tom and I', answer: 'are', wrong: ['am', 'is'] },
  ];
  for (const item of beVerbs) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '英语',
      stem: `选择正确的 be 动词：${item.subject} ____ a student.`,
      options: choice.options,
      answer: choice.answer,
      analysis: `主语 ${item.subject} 后面用 ${item.answer}。口诀：I 用 am，you 用 are，is 连着他她它，复数全用 are。`,
      knowledgePoints: ['be 动词', '主谓一致'],
    });
  }

  const thirdPerson: { verb: string; answer: string; wrong: string[] }[] = [
    { verb: 'go', answer: 'goes', wrong: ['go', 'going', 'went'] },
    { verb: 'watch', answer: 'watches', wrong: ['watch', 'watchs', 'watching'] },
    { verb: 'study', answer: 'studies', wrong: ['studys', 'study', 'studied'] },
    { verb: 'have', answer: 'has', wrong: ['have', 'haves', 'having'] },
  ];
  for (const item of thirdPerson) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '英语',
      stem: `He ____ (${item.verb}) to school every day. 选择正确形式：`,
      options: choice.options,
      answer: choice.answer,
      analysis: `一般现在时中，主语是第三人称单数 He，动词要加 -s/-es，${item.verb} → ${item.answer}。`,
      knowledgePoints: ['一般现在时', '第三人称单数'],
    });
  }

  const presentContinuous: { verb: string; answer: string; wrong: string[] }[] = [
    { verb: 'run', answer: 'is running', wrong: ['is runing', 'are running', 'runs'] },
    { verb: 'write', answer: 'is writing', wrong: ['is writeing', 'is writting', 'writes'] },
    { verb: 'swim', answer: 'is swimming', wrong: ['is swiming', 'is swim', 'swims'] },
  ];
  for (const item of presentContinuous) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '英语',
      stem: `Look! The boy ____ now. (${item.verb})`,
      options: choice.options,
      answer: choice.answer,
      analysis: `Look! / now 提示现在进行时，结构是 be + 动词-ing，${item.verb} 的 -ing 形式是 ${item.answer.replace('is ', '')}。`,
      knowledgePoints: ['现在进行时', '动词 ing 形式'],
    });
  }

  const plurals: { word: string; answer: string; wrong: string[] }[] = [
    { word: 'box', answer: 'boxes', wrong: ['boxs', 'boxies', 'box'] },
    { word: 'child', answer: 'children', wrong: ['childs', 'childrens', 'childes'] },
    { word: 'knife', answer: 'knives', wrong: ['knifes', 'knifes', 'knife'] },
    { word: 'photo', answer: 'photos', wrong: ['photoes', 'photo', 'photoies'] },
  ];
  for (const item of plurals) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '英语',
      stem: `${item.word} 的复数形式是：`,
      options: choice.options,
      answer: choice.answer,
      analysis: `${item.word} 属于特殊变化，复数是 ${item.answer}。`,
      knowledgePoints: ['名词复数', '特殊变化'],
    });
  }

  const prepositions: { sentence: string; answer: string; wrong: string[] }[] = [
    { sentence: 'The book is ____ the desk.', answer: 'on', wrong: ['in', 'at', 'under'] },
    { sentence: 'We go to school ____ Monday.', answer: 'on', wrong: ['in', 'at', 'to'] },
    { sentence: 'She gets up ____ 7 o\'clock.', answer: 'at', wrong: ['in', 'on', 'for'] },
    { sentence: 'I was born ____ 2015.', answer: 'in', wrong: ['on', 'at', 'to'] },
  ];
  for (const item of prepositions) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '英语',
      stem: `选择正确的介词：${item.sentence}`,
      options: choice.options,
      answer: choice.answer,
      analysis: `具体时间点用 at，具体某天用 on，年/月/季节用 in；位置关系要看语境，这里填 ${item.answer}。`,
      knowledgePoints: ['介词用法', '时间介词'],
    });
  }

  const translations: { cn: string; answer: string; wrong: string[] }[] = [
    { cn: '我每天早上七点起床。', answer: 'I get up at seven every morning.', wrong: ['I get up in seven every morning.', 'I am get up at seven every morning.', 'I gets up at seven every morning.'] },
    { cn: '她喜欢唱歌。', answer: 'She likes singing.', wrong: ['She like singing.', 'She likes sing.', 'She is like singing.'] },
    { cn: '昨天我们去了公园。', answer: 'We went to the park yesterday.', wrong: ['We go to the park yesterday.', 'We are going to the park yesterday.', 'We goed to the park yesterday.'] },
  ];
  for (const item of translations) {
    const choice = options(item.answer, item.wrong);
    items.push({
      subject: '英语',
      stem: `选出正确的英文翻译：${item.cn}`,
      options: choice.options,
      answer: choice.answer,
      analysis: `注意时态和人称：${item.answer}`,
      knowledgePoints: ['英汉互译', '时态'],
    });
  }

  return items;
}

/* ---------------- 写入 ---------------- */

ensureDataDirs();
const db = openDb(dbFile());
const repo = new ProblemRepo(db);

if (clearOnly) {
  const result = db.prepare('DELETE FROM problems WHERE source = ?').run(SOURCE);
  console.log(`已删除示例题 ${Number(result.changes)} 道，剩余 ${repo.count()} 道。`);
  db.close();
  process.exit(0);
}

const builders: Record<string, () => Item[]> = {
  数学: mathItems,
  语文: chineseItems,
  英语: englishItems,
};
const perSubject = Math.ceil(TOTAL / 3);
const picked: Item[] = [];
for (const subject of ['数学', '语文', '英语']) {
  const seen = new Set<string>();
  for (let round = 0; round < 8 && seen.size < perSubject; round += 1) {
    for (const item of builders[subject]()) {
      if (seen.size >= perSubject) break;
      if (seen.has(item.stem)) continue;
      seen.add(item.stem);
      picked.push(item);
    }
  }
}

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

for (const item of picked) {
  const daysAgo = int(0, 120);
  const createdAt = new Date(now - daysAgo * day - int(0, 20) * 60 * 60 * 1000).toISOString();
  const wrongCount = random() < 0.45 ? int(1, 3) : 0;
  // 每次错误给一个时间：首次是创建时间，其余落在创建时间和现在之间
  const wrongTimes = [createdAt];
  for (let i = 0; i < wrongCount; i += 1) {
    const span = now - new Date(createdAt).getTime();
    wrongTimes.push(new Date(new Date(createdAt).getTime() + Math.floor(random() * span)).toISOString());
  }
  const draft = repo.importDraft({
    subject: item.subject,
    grade: pick(GRADES),
    stem: item.stem,
    options: item.options ?? [],
    answer: item.answer,
    analysis: item.analysis,
    knowledgePoints: item.knowledgePoints,
    source: SOURCE,
    imagePath: null,
    createdAt,
    wrongCount: wrongCount + 1,
    wrongTimes,
    mastered: random() < 0.3,
  });
  void draft;
}

const subjects = repo.subjects().map((item) => `${item.subject} ${item.n}`).join('，');
console.log('');
console.log(`已追加示例题 ${picked.length} 道（source = ${SOURCE}）`);
console.log(`当前题库：${repo.count()} 道（${subjects}）`);
console.log('想删掉示例题：npm run seed:demo -- --clear');
console.log('');
db.close();
