/**
 * 题目数据模型与输入规范化。
 * 服务端（入库）和 AI 返回解析共用这里，保证两条路径产出一致。
 */

export type ProblemOption = { key: string; text: string };

/** 题目在原图里的位置：[x1, y1, x2, y2]，0~1 的相对比例 */
export type BoundingBox = [number, number, number, number];

/** 一次识别最多返回几道题（一张试卷可能几十道，上限放宽到 50） */
export const MAX_DRAFT_ITEMS = 50;

export type ProblemDraft = {
  subject: string;
  grade: string;
  unit: string;
  semester: string;
  problemType: string;
  stem: string;
  options: ProblemOption[];
  answer: string;
  analysis: string;
  knowledgePoints: string[];
  source: string;
  imagePath: string | null;
  /** 只有图片识别会给出，用于前端把原图切成单题；不落库 */
  bbox?: BoundingBox | null;
};

export type Problem = ProblemDraft & {
  id: number;
  wrongCount: number;
  /** 每次「又错了」的时间，倒序（最多 8 条） */
  wrongTimes: string[];
  mastered: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProblemFilter = {
  limit?: number;
  offset?: number;
  subject?: string;
  grade?: string;
  unit?: string;
  semester?: string;
  knowledgePoint?: string;
  mastered?: boolean;
  q?: string;
  /** 至少错了几次 */
  minWrongCount?: number;
  /** ISO 时间，筛选发生在该时间之前/之后的错题（任意一次错误时间命中即可） */
  createdBefore?: string;
  createdAfter?: string;
};

export const SUBJECTS = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '政治',
  '历史',
  '地理',
  '科学',
  '其他',
] as const;

export class ValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.code = 'VALIDATION_FAILED';
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function trimAll(value: unknown): string {
  return asString(value).replace(/\r\n/g, '\n').trim();
}

const OPTION_LINE = /^([A-Za-z])\s*[.、:：)）]\s*(.*)$/;

/** 把 "A. 3/4" 这种行文本解析成选项对象 */
export function parseOptionLines(line: string, index: number): ProblemOption {
  const matched = line.match(OPTION_LINE);
  if (matched) return { key: matched[1].toUpperCase(), text: matched[2].trim() };
  return { key: String.fromCharCode(65 + index), text: line.trim() };
}

function normalizeOptions(raw: unknown): ProblemOption[] {
  if (Array.isArray(raw)) {
    const list: ProblemOption[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        const line = item.trim();
        if (line) list.push(parseOptionLines(line, list.length));
        continue;
      }
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const key = trimAll(obj.key ?? obj.label ?? obj.option ?? '') || String.fromCharCode(65 + list.length);
        const text = trimAll(obj.text ?? obj.content ?? obj.value ?? '');
        if (text) list.push({ key: key.toUpperCase().slice(0, 2), text });
      }
    }
    return list;
  }
  const text = trimAll(raw);
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseOptionLines(line, index));
}

function normalizeKnowledgePoints(raw: unknown): string[] {
  const parts: string[] = [];
  const push = (value: unknown) => {
    const text = asString(value).trim();
    if (text) parts.push(text);
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (typeof raw === 'string') raw.split(/[,，;；、\n]/).forEach(push);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of parts) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item.slice(0, 40));
    if (result.length >= 8) break;
  }
  return result;
}

function normalizeImagePath(raw: unknown): string | null {
  const text = trimAll(raw);
  if (!text) return null;
  if (/^\/images\/[A-Za-z0-9._-]+$/.test(text)) return text;
  return null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 把 AI 给的各种 bounding box 写法统一成 0~1 的 [x1,y1,x2,y2]。
 * 兼容 0~1、0~100、0~1000 三种常见量纲，也兼容 x2<x1 的写反。
 */
export function normalizeBbox(raw: unknown): BoundingBox | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const numbers = raw.slice(0, 4).map((value) => (typeof value === 'string' ? Number(value) : value));
  if (!numbers.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) return null;
  const max = Math.max(...numbers.map(Math.abs));
  const scale = max <= 1 ? 1 : max <= 100 ? 100 : max <= 1000 ? 1000 : max;
  let [x1, y1, x2, y2] = numbers.map((value) => clamp01(value / scale)) as BoundingBox;
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  if (x2 - x1 < 0.01 || y2 - y1 < 0.01) return null;
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return [round(x1), round(y1), round(x2), round(y2)];
}

export type NormalizeOptions = {
  requireStem?: boolean;
  requireAnswer?: boolean;
};

/**
 * 把任意来源（表单 / AI 返回）的题目对象规范化为 ProblemDraft。
 * 默认要求题干非空；入库时还会要求答案非空（见 NormalizeOptions）。
 */
export function normalizeDraft(raw: unknown, options: NormalizeOptions = {}): ProblemDraft {
  const { requireStem = true, requireAnswer = false } = options;
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const draft: ProblemDraft = {
    subject: trimAll(obj.subject).slice(0, 20),
    grade: trimAll(obj.grade).slice(0, 20),
    unit: trimAll(obj.unit ?? obj.chapter).slice(0, 30),
    semester: trimAll(obj.semester ?? obj.term).slice(0, 20),
    problemType: trimAll(obj.problemType ?? obj.problem_type ?? obj.type).slice(0, 20),
    stem: trimAll(obj.stem ?? obj.question ?? obj.content ?? obj.text),
    options: normalizeOptions(obj.options ?? obj.choices),
    answer: trimAll(obj.answer ?? obj.correctAnswer ?? obj.solution),
    analysis: trimAll(obj.analysis ?? obj.explanation ?? obj.analyze),
    knowledgePoints: normalizeKnowledgePoints(
      obj.knowledgePoints ?? obj.knowledge_points ?? obj.points ?? obj.tags,
    ),
    source: trimAll(obj.source).slice(0, 40),
    imagePath: normalizeImagePath(obj.imagePath ?? obj.image_path),
    bbox: normalizeBbox(obj.bbox ?? obj.box ?? obj.bounds ?? obj.rect ?? obj.region),
  };
  if (requireStem && !draft.stem) {
    throw new ValidationError('题干不能为空');
  }
  if (requireAnswer && !draft.answer) {
    throw new ValidationError('答案不能为空，请先补上答案（不会做可以先点「AI 整理」或写「待解」）');
  }
  return draft;
}

/**
 * 从 AI 返回的 JSON 里取出题目数组。
 * 兼容 {items:[...]}、{questions:[...]}、裸数组、单个对象。
 */
export function normalizeDraftList(
  raw: unknown,
  requireStem = false,
  limit = MAX_DRAFT_ITEMS,
): ProblemDraft[] {
  const obj = raw as Record<string, unknown> | unknown[] | null;
  let list: unknown[] = [];
  if (Array.isArray(obj)) list = obj;
  else if (obj && typeof obj === 'object') {
    const container = obj as Record<string, unknown>;
    const candidates = [container.items, container.questions, container.problems, container.data];
    const found = candidates.find((value) => Array.isArray(value));
    list = Array.isArray(found) ? (found as unknown[]) : [container];
  }

  const drafts: ProblemDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const draft = normalizeDraft(item, { requireStem, requireAnswer: false });
    if (!draft.stem) continue;
    drafts.push(draft);
    if (drafts.length >= Math.max(1, limit)) break;
  }
  return drafts;
}
