import fs from 'node:fs';
import path from 'node:path';
import { dataDir, ensureDataDirs } from './paths.ts';
import { SUBJECTS } from './model.ts';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: { key: Difficulty; label: string }[] = [
  { key: 'easy', label: '容易' },
  { key: 'medium', label: '中等' },
  { key: 'hard', label: '难' },
];

export type PromptTrip = Record<Difficulty, string>;
export type PromptBook = Record<string, PromptTrip>;

/** 「通用」作为兜底：某个学科没单独配置时用它 */
export const GENERIC_SUBJECT = '通用';

const DEFAULT_PROMPTS: PromptBook = {
  数学: {
    easy: '只把原题中的数字换成新的数字，保持题型、运算顺序、解题步骤和知识点完全不变；答案要按新数字重新算对。',
    medium:
      '知识点保持不变，但反转题目的逻辑或已知条件，例如把「大于」改成「小于」、把「求剩下多少」改成「求原来有多少」、把「多多少」改成「少多少」；解法仍然唯一，但需要多绕一步。',
    hard: '围绕同一个知识点重新设计一道新题：换情境、增加一步推理或加一个容易用错的干扰条件，难度明显高于原题；答案和解析要完整推演。',
  },
  语文: {
    easy: '只把原题中的句子、词语、人名或数字替换成新的，保持题型、考查点和题干结构完全不变。',
    medium:
      '考查点保持不变，但改变提问角度或反向设问，例如把「选出正确的一项」改成「选出有错误的一项」、把「找近义词」改成「找反义词」、把「填空」改成「判断并改正」。',
    hard: '围绕同一个知识点重新设计一道综合题：可以换文体、换情境或增加一个比较项，难度高于原题，并给出完整答案与解析。',
  },
  英语: {
    easy: '只替换原题中的单词、人名或数字，保持句式、时态和考查点完全不变，答案随替换内容调整。',
    medium:
      '考查点保持不变，但反转句子条件或语境，例如肯定句改成否定句、单数改成复数、把时间状语挪到过去、把主语换成第三人称，让答案需要重新判断。',
    hard: '围绕同一个知识点重新设计一道题：换情境、增加干扰项或综合两个考点，难度高于原题，并给出完整答案与解析。',
  },
  [GENERIC_SUBJECT]: {
    easy: '只替换原题中的人物、数字或具体名词，保持题型、解题思路和知识点不变，答案同步更新。',
    medium: '知识点保持不变，但改变设问角度或反转题目条件，让思路需要多绕一步，答案仍然唯一。',
    hard: '围绕同一个知识点重新设计一道更有难度的题，换情境或增加一步推理，并给出完整答案与解析。',
  },
};

export const PROMPT_SUBJECTS: string[] = [...SUBJECTS, GENERIC_SUBJECT];

export function promptsFile(): string {
  return path.join(dataDir(), 'prompts.json');
}

function emptyTrip(): PromptTrip {
  return { easy: '', medium: '', hard: '' };
}

/** 读取用户改过的提示词（只存覆盖项，空字符串表示用默认/通用） */
export function loadPromptOverrides(): PromptBook {
  ensureDataDirs();
  const file = promptsFile();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const book: PromptBook = {};
    for (const [subject, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const trip = emptyTrip();
      for (const { key } of DIFFICULTIES) {
        const text = (value as Record<string, unknown>)[key];
        if (typeof text === 'string' && text.trim()) trip[key] = text.trim().slice(0, 2000);
      }
      book[subject] = trip;
    }
    return book;
  } catch {
    // 文件坏了就当没配置，不阻塞练习页
    return {};
  }
}

export function savePromptOverrides(input: unknown): PromptBook {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const book: PromptBook = {};
  for (const [subject, value] of Object.entries(source)) {
    if (!PROMPT_SUBJECTS.includes(subject)) continue;
    if (!value || typeof value !== 'object') continue;
    const trip = emptyTrip();
    for (const { key } of DIFFICULTIES) {
      const text = (value as Record<string, unknown>)[key];
      if (typeof text === 'string' && text.trim()) trip[key] = text.trim().slice(0, 2000);
    }
    book[subject] = trip;
  }
  ensureDataDirs();
  fs.writeFileSync(promptsFile(), JSON.stringify(book, null, 2), 'utf8');
  return book;
}

/** 某学科某难度最终生效的提示词：学科覆盖 → 通用覆盖 → 学科默认 → 通用默认 */
export function resolvePrompt(subject: string, difficulty: Difficulty, overrides = loadPromptOverrides()): string {
  const own = overrides[subject]?.[difficulty];
  if (own) return own;
  const generic = overrides[GENERIC_SUBJECT]?.[difficulty];
  if (generic) return generic;
  return DEFAULT_PROMPTS[subject]?.[difficulty] ?? DEFAULT_PROMPTS[GENERIC_SUBJECT][difficulty];
}

export function defaultPrompt(subject: string, difficulty: Difficulty): string {
  return DEFAULT_PROMPTS[subject]?.[difficulty] ?? DEFAULT_PROMPTS[GENERIC_SUBJECT][difficulty];
}

/** 设置页展示用：所有学科三个难度的最终提示词 */
export function effectivePromptBook(): PromptBook {
  const overrides = loadPromptOverrides();
  const book: PromptBook = {};
  for (const subject of PROMPT_SUBJECTS) {
    const trip = emptyTrip();
    for (const { key } of DIFFICULTIES) trip[key] = resolvePrompt(subject, key, overrides);
    book[subject] = trip;
  }
  return book;
}

export function defaultPromptBook(): PromptBook {
  const book: PromptBook = {};
  for (const subject of PROMPT_SUBJECTS) {
    const trip = emptyTrip();
    for (const { key } of DIFFICULTIES) trip[key] = defaultPrompt(subject, key);
    book[subject] = trip;
  }
  return book;
}

export type PromptVars = {
  subject: string;
  grade: string;
  stem: string;
  options: string;
  answer: string;
  analysis: string;
  knowledgePoints: string;
};

/** 把 {stem} 这类占位符替换成实际内容 */
export function renderPrompt(template: string, vars: PromptVars): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => {
    const value = (vars as Record<string, string>)[key];
    return value === undefined ? all : value;
  });
}
