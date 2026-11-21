import type { Problem, ProblemDraft, ProblemOption } from './types';

export type ProblemForm = {
  key: string;
  id?: number;
  imagePath: string | null;
  subject: string;
  grade: string;
  unit: string;
  semester: string;
  problemType: string;
  mastered: boolean;
  stem: string;
  optionsText: string;
  answer: string;
  analysis: string;
  knowledgeText: string;
};

export function newKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const OPTION_LINE = /^([A-Za-z])\s*[.、:：)）]\s*(.*)$/;

export function parseOptionsText(text: string): ProblemOption[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const matched = line.match(OPTION_LINE);
      if (matched) return { key: matched[1].toUpperCase(), text: matched[2].trim() };
      return { key: String.fromCharCode(65 + index), text: line };
    });
}

export function optionsToText(options: ProblemOption[]): string {
  return options.map((option) => `${option.key}. ${option.text}`).join('\n');
}

export function emptyForm(): ProblemForm {
  return {
    key: newKey(),
    imagePath: null,
    subject: '',
    grade: '',
    unit: '',
    semester: '',
    problemType: '',
    mastered: false,
    stem: '',
    optionsText: '',
    answer: '',
    analysis: '',
    knowledgeText: '',
  };
}

export function formFromDraft(draft: ProblemDraft, key = newKey()): ProblemForm {
  return {
    key,
    imagePath: draft.imagePath ?? null,
    subject: draft.subject ?? '',
    grade: draft.grade ?? '',
    unit: draft.unit ?? '',
    semester: draft.semester ?? '',
    problemType: draft.problemType ?? '',
    mastered: false,
    stem: draft.stem ?? '',
    optionsText: optionsToText(draft.options ?? []),
    answer: draft.answer ?? '',
    analysis: draft.analysis ?? '',
    knowledgeText: (draft.knowledgePoints ?? []).join('，'),
  };
}

export function formFromProblem(problem: Problem): ProblemForm {
  return { ...formFromDraft(problem), id: problem.id, mastered: problem.mastered };
}

export function formToPayload(form: ProblemForm): ProblemDraft & { source: string; mastered: boolean } {
  return {
    subject: form.subject.trim(),
    grade: form.grade.trim(),
    unit: form.unit.trim(),
    semester: form.semester.trim(),
    problemType: form.problemType.trim(),
    stem: form.stem.trim(),
    options: parseOptionsText(form.optionsText),
    answer: form.answer.trim(),
    analysis: form.analysis.trim(),
    knowledgePoints: form.knowledgeText
      .split(/[,，、;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
    imagePath: form.imagePath,
    source: form.id ? '手动编辑' : '手动录入',
    mastered: form.mastered,
  };
}

export function splitKnowledge(text: string): string[] {
  return text
    .split(/[,，、;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
