import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { formFromDraft, parseOptionsText, type ProblemForm } from '../form';
import { printPaper } from '../print';
import {
  DIFFICULTY_LABELS,
  GRADES,
  SEMESTERS,
  UNITS,
  type Difficulty,
  type Problem,
  type ProblemDraft,
  type ProblemListResponse,
} from '../types';
import { sortByList } from '../utils';

const PAGE_SIZE = 50;

type Range = {
  key: string;
  label: string;
  /** 最近 N 天（N 天前到今天） */
  days?: number;
};

const RANGES: Range[] = [
  { key: 'recent-3', label: '最近 3 天', days: 3 },
  { key: 'recent-5', label: '最近 5 天', days: 5 },
  { key: 'recent-7', label: '最近 7 天', days: 7 },
  { key: 'recent-15', label: '最近 15 天', days: 15 },
  { key: 'recent-30', label: '最近 30 天', days: 30 },
  { key: 'all', label: '全部错题' },
];

const WRONG_COUNTS = [
  { value: '1', label: '错 1 次以上' },
  { value: '2', label: '错 2 次以上' },
  { value: '3', label: '错 3 次以上' },
  { value: '5', label: '错 5 次以上' },
];

/** 本次练习卷里的一道题（只存在于页面上，不入库） */
type SheetItem = {
  form: ProblemForm;
  fromId: number;
  difficulty: Difficulty;
};

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  return diff <= 0 ? '今天' : `${diff} 天前`;
}

function latestWrongTime(problem: Problem): string {
  return problem.wrongTimes.length > 0 ? problem.wrongTimes[0] : problem.createdAt;
}

type Props = {
  healthReady: boolean;
};

export function Practice({ healthReady }: Props) {
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [semester, setSemester] = useState('');
  const [unit, setUnit] = useState('');
  const [minWrong, setMinWrong] = useState('1');
  const [rangeKey, setRangeKey] = useState('recent-5');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [semesters, setSemesters] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [items, setItems] = useState<Problem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notConfigured, setNotConfigured] = useState(false);
  const [difficulty, setDifficulty] = useState<Record<number, Difficulty>>({});
  const [generating, setGenerating] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetItem[]>([]);
  const [notice, setNotice] = useState('');
  const [withAnswers, setWithAnswers] = useState(false);
  const [printing, setPrinting] = useState(false);

  const range = RANGES.find((item) => item.key === rangeKey) ?? RANGES[1];

  useEffect(() => {
    api<{
      subjects: { subject: string; n: number }[];
      grades: { grade: string; n: number }[];
      units: { unit: string; n: number }[];
      semesters: { semester: string; n: number }[];
    }>('/api/filters')
      .then((result) => {
        setSubjects(result.subjects.map((item) => item.subject));
        setGrades(result.grades.map((item) => item.grade));
        setUnits(result.units.map((item) => item.unit));
        setSemesters(result.semesters.map((item) => item.semester));
      })
      .catch(() => {
        setSubjects([]);
        setGrades([]);
        setUnits([]);
        setSemesters([]);
      });
  }, []);

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (subject) params.set('subject', subject);
        if (grade) params.set('grade', grade);
        if (semester) params.set('semester', semester);
        if (unit) params.set('unit', unit);
        if (minWrong) params.set('minWrongCount', minWrong);
        params.set('mastered', '0');
        if (range.days) params.set('after', daysAgo(range.days));
        const result = await api<ProblemListResponse>(`/api/problems?${params.toString()}`);
        setTotal(result.total);
        setItems((prev) => (offset === 0 ? result.items : [...prev, ...result.items]));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, grade, semester, unit, minWrong, rangeKey],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  function difficultyOf(id: number): Difficulty {
    return difficulty[id] ?? 'medium';
  }

  async function generate(problem: Problem): Promise<void> {
    const level = difficultyOf(problem.id);
    setGenerating(problem.id);
    setError('');
    setNotConfigured(false);
    setNotice('');
    try {
      const result = await api<{ items: ProblemDraft[]; model: string; difficulty: Difficulty }>(
        '/api/practice/generate',
        { method: 'POST', body: { problemId: problem.id, difficulty: level }, timeoutMs: 150000 },
      );
      if (!result.items.length) {
        setError('AI 没有生成内容，换个难度再试');
        return;
      }
      setSheet((prev) => [
        { form: formFromDraft(result.items[0]), fromId: problem.id, difficulty: result.difficulty },
        ...prev,
      ]);
      setNotice(`已生成 1 道「${DIFFICULTY_LABELS[result.difficulty]}」新题，共 ${sheet.length + 1} 题，可以直接打印`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AI_NOT_CONFIGURED') {
        setNotConfigured(true);
      }
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(null);
    }
  }

  function removeSheetItem(index: number): void {
    setSheet((prev) => prev.filter((_, i) => i !== index));
  }

  /** 打印「当前筛选出的全部错题」，不是 AI 生成的新题 */
  async function printFiltered(): Promise<void> {
    setPrinting(true);
    setError('');
    try {
      const collected: Problem[] = [];
      let offset = 0;
      for (let page = 0; page < 20; page += 1) {
        const params = new URLSearchParams({ limit: '200', offset: String(offset) });
        if (subject) params.set('subject', subject);
        if (grade) params.set('grade', grade);
        if (semester) params.set('semester', semester);
        if (unit) params.set('unit', unit);
        if (minWrong) params.set('minWrongCount', minWrong);
        params.set('mastered', '0');
        if (range.days) params.set('after', daysAgo(range.days));
        const result = await api<ProblemListResponse>(`/api/problems?${params.toString()}`);
        collected.push(...result.items);
        offset += result.items.length;
        if (result.items.length === 0 || offset >= result.total) break;
      }
      if (collected.length === 0) {
        setError('当前筛选没有题目，没法打印');
        return;
      }
      printPaper(
        collected.map((problem) => ({
          subject: problem.subject,
          grade: problem.grade,
          unit: problem.unit,
          problemType: problem.problemType,
          stem: problem.stem,
          options: problem.options,
          answer: problem.answer,
          analysis: problem.analysis,
        })),
        { withAnswers },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '打印失败');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="page">
      <section className="card">
        <div className="filters">
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="">全部学科</option>
            {subjects.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={rangeKey} onChange={(event) => setRangeKey(event.target.value)}>
            {RANGES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <select value={grade} onChange={(event) => setGrade(event.target.value)}>
            <option value="">全部年级</option>
            {sortByList(grades, GRADES).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={semester} onChange={(event) => setSemester(event.target.value)}>
            <option value="">全部学期</option>
            {sortByList(semesters, SEMESTERS).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="">全部单元</option>
            {sortByList(units, UNITS).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={minWrong} onChange={(event) => setMinWrong(event.target.value)}>
            {WRONG_COUNTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <span className="muted">{loading ? '加载中…' : `共 ${total} 道`}</span>
        </div>
        <p className="muted small practice-hint">
          只列出还没掌握、且符合筛选条件的错题（同一道题错过多次时，任意一次落在时间范围内就会列出）。「AI
          重新生成」出的变式题只在屏幕上练习，不入库；「打印试卷」打印的是下面筛选出的全部错题（答案可选）。
        </p>
        <div className="row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={withAnswers}
              onChange={(event) => setWithAnswers(event.target.checked)}
            />
            打印时带答案
          </label>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void printFiltered()}
            disabled={printing || total === 0}
          >
            {printing ? '准备中…' : `打印试卷（${total} 题）`}
          </button>
        </div>
      </section>

      {notConfigured && (
        <div className="alert alert--warn">还没配置 AI，请在 data/config.json 填 apiKey 后再来练习。</div>
      )}
      {error && <div className="alert alert--error">{error}</div>}
      {notice && (
        <div className="alert alert--info" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}

      {sheet.length > 0 && (
        <section className="card sheet">
          <div className="section-head">
            <h2>AI 变式题（{sheet.length} 题 · 仅本次练习）</h2>
            <div className="sheet-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet([])}>
                清空
              </button>
            </div>
          </div>
          <p className="muted small">变式题只用于屏幕练习，不写进错题本，原错题也不变；打印试卷打印的是下面的筛选结果。</p>

          {sheet.map((item, index) => (
            <article className="sheet-item" key={item.form.key}>
              <header>
                <span className="sheet-no">{index + 1}</span>
                <span className="chips">
                  {item.form.subject && <span className="chip chip--subject">{item.form.subject}</span>}
                  {item.form.grade && <span className="chip">{item.form.grade}</span>}
                  <span className="chip">{DIFFICULTY_LABELS[item.difficulty]}</span>
                  <span className="chip">原题 #{item.fromId}</span>
                </span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeSheetItem(index)}>
                  移除
                </button>
              </header>
              <p className="stem">{item.form.stem}</p>
              {item.form.optionsText.trim() && (
                <ul className="options">
                  {parseOptionsText(item.form.optionsText).map((option) => (
                    <li key={option.key}>
                      <b>{option.key}.</b> {option.text}
                    </li>
                  ))}
                </ul>
              )}
              <details>
                <summary>查看答案与解析</summary>
                <p className="answer">
                  <span className="label">答案</span> {item.form.answer}
                </p>
                {item.form.analysis && <p className="analysis">{item.form.analysis}</p>}
              </details>
            </article>
          ))}
        </section>
      )}

      {!loading && items.length === 0 && (
        <div className="empty">
          <p>这个范围里没有错题。</p>
          <p className="muted">换个时间范围或年级，或者先去「加题目」录几道。</p>
        </div>
      )}

      <div className="list">
        {items.map((problem) => (
          <article className="card practice-item" key={problem.id}>
            <header>
              <div className="chips">
                {problem.subject && <span className="chip chip--subject">{problem.subject}</span>}
                {problem.grade && <span className="chip">{problem.grade}</span>}
                {problem.semester && <span className="chip">{problem.semester}</span>}
                {problem.unit && <span className="chip">{problem.unit}</span>}
                {problem.problemType && <span className="chip">{problem.problemType}</span>}
                {problem.knowledgePoints.map((point) => (
                  <span className="chip chip--point" key={point}>
                    {point}
                  </span>
                ))}
              </div>
              <span className="muted small mono">
                #{problem.id} · 最近错在 {formatDate(latestWrongTime(problem))}
              </span>
            </header>

            <p className="stem">{problem.stem}</p>
            {problem.options.length > 0 && (
              <ul className="options">
                {problem.options.map((option) => (
                  <li key={option.key}>
                    <b>{option.key}.</b> {option.text}
                  </li>
                ))}
              </ul>
            )}

            <footer className="practice-item__foot">
              <span className="muted small">生成难度</span>
              <select
                className="select-inline"
                value={difficultyOf(problem.id)}
                onChange={(event) =>
                  setDifficulty((prev) => ({ ...prev, [problem.id]: event.target.value as Difficulty }))
                }
                disabled={generating === problem.id}
              >
                {(['easy', 'medium', 'hard'] as Difficulty[]).map((key) => (
                  <option key={key} value={key}>
                    {DIFFICULTY_LABELS[key]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={() => void generate(problem)}
                disabled={generating !== null || !healthReady}
              >
                {generating === problem.id ? '生成中…' : 'AI 重新生成'}
              </button>
              {problem.wrongCount > 0 && <span className="muted small">错过 {problem.wrongCount} 次</span>}
            </footer>
          </article>
        ))}
      </div>

      {items.length < total && (
        <div className="center">
          <button type="button" className="btn" disabled={loading} onClick={() => void load(items.length)}>
            {loading ? '加载中…' : `加载更多（还有 ${total - items.length} 道）`}
          </button>
        </div>
      )}
    </div>
  );
}
