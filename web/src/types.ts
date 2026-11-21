export type ProblemOption = { key: string; text: string };

export type ProblemDraft = {
  subject: string;
  grade: string;
  stem: string;
  options: ProblemOption[];
  answer: string;
  analysis: string;
  knowledgePoints: string[];
  source: string;
  imagePath: string | null;
};

export type Problem = ProblemDraft & {
  id: number;
  wrongCount: number;
  mastered: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiSide = {
  ready: boolean;
  baseURL: string;
  model: string;
  keySet: boolean;
  headerNames: string[];
};

export type Health = {
  ok: boolean;
  version: string;
  dataDir: string;
  problems: number;
  images: number;
  ai: {
    configPath: string;
    text: AiSide;
    vision: AiSide;
  };
};

export type ProblemListResponse = {
  items: Problem[];
  total: number;
  subjects: { subject: string; n: number }[];
  grades: { grade: string; n: number }[];
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
];

/** 年级下拉选项：三年级 ~ 六年级 */
export const GRADES = ['三年级', '四年级', '五年级', '六年级'];

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '容易',
  medium: '中等',
  hard: '难',
};

export type PromptTrip = Record<Difficulty, string>;
export type PromptBook = Record<string, PromptTrip>;
