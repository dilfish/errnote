export type ProblemOption = { key: string; text: string };

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
  /** 图片识别时 AI 给出的题目位置 [x1,y1,x2,y2]，0~1 相对比例 */
  bbox?: [number, number, number, number] | null;
};

export type Problem = ProblemDraft & {
  id: number;
  wrongCount: number;
  wrongTimes: string[];
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
  units: { unit: string; n: number }[];
  semesters: { semester: string; n: number }[];
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

export const SEMESTERS = ['上学期', '下学期'];

export const UNITS = [
  '第一单元',
  '第二单元',
  '第三单元',
  '第四单元',
  '第五单元',
  '第六单元',
  '第七单元',
  '第八单元',
  '期中复习',
  '期末复习',
];

export const PROBLEM_TYPES = ['选择题', '填空题', '判断题', '计算题', '解答题', '应用题', '其他'];

/** 一次识别最多几道题（和服务端 MAX_DRAFT_ITEMS 保持一致） */
export const MAX_DRAFT_ITEMS = 50;

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '容易',
  medium: '中等',
  hard: '难',
};

export type PromptTrip = Record<Difficulty, string>;
export type PromptBook = Record<string, PromptTrip>;
