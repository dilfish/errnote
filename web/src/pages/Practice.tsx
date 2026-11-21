import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api';
import { formFromDraft, parseOptionsText, type ProblemForm } from '../form';
import { printPaper } from '../print';
import { loadStored, saveStored } from '../storage';
import {
  DIFFICULTY_LABELS,
  type Difficulty,
  type Problem,
  type ProblemDraft,
  type ProblemListResponse,
} from '../types';

const PAGE_SIZE = 50;

/** 本次练习里某道错题被替换成的变式题（只存在于页面上，不入库） */
type Variant = {
  form: ProblemForm;
  difficulty: Difficulty;
  /** 生成时的原题快照，点「查看原题」时展示 */
  original: Problem;
};

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  return diff <= 0 ? '今天' : `${diff} 天前`;
}

/** createdAt 只是录入时间；只有真正记过错误时才有错误时间 */
function latestWrongLabel(problem: Problem): string {
  if (problem.wrongTimes.length > 0) return `最近错在 ${formatDate(problem.wrongTimes[0])}`;
  return `录入于 ${formatDate(problem.createdAt)}`;
}

type Props = {
  healthReady: boolean;
};

const FILTER_KEY = 'errnote.filters.practice';

const DEFAULT_FILTERS = {
  subject: '',
  withAnswers: false,
};

function initialFilters() {
  const stored = loadStored(FILTER_KEY, DEFAULT_FILTERS);
  return {
    subject: typeof stored.subject === 'string' ? stored.subject : '',
    withAnswers: stored.withAnswers === true,
  };
}

export function Practice({ healthReady }: Props) {
  const stored = useMemo(initialFilters, []);
  const [subject, setSubject] = useState(stored.subject);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [items, setItems] = useState<Problem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notConfigured, setNotConfigured] = useState(false);
  const [difficulty, setDifficulty] = useState<Record<number, Difficulty>>({});
  const [generating, setGenerating] = useState<number | null>(null);
  /** 原题 id → 用来替换显示它的变式题 */
  const [variants, setVariants] = useState<Record<number, Variant>>({});
  const [openOriginals, setOpenOriginals] = useState<Record<number, boolean>>({});
  const [notice, setNotice] = useState('');
  const [withAnswers, setWithAnswers] = useState(stored.withAnswers);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    api<{ subjects: { subject: string; n: number }[] }>('/api/subjects')
      .then((result) => {
        setSubjects(result.subjects.map((item) => item.subject));
      })
      .catch(() => {
        setSubjects([]);
      });
  }, []);

  useEffect(() => {
    saveStored(FILTER_KEY, { subject, withAnswers });
  }, [subject, withAnswers]);

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (subject) params.set('subject', subject);
        params.set('mastered', '0');
        params.set('scope', 'weekly');
        const result = await api<ProblemListResponse>(`/api/problems?${params.toString()}`);
        setTotal(result.total);
        setItems((prev) => (offset === 0 ? result.items : [...prev, ...result.items]));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [subject],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  function difficultyOf(id: number): Difficulty {
    return difficulty[id] ?? 'medium';
  }

  async function generate(problem: Problem): Promise<void> {
    const level = difficultyOf(problem.id);
    const replacing = variants[problem.id] !== undefined;
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
      // 就地替换这道题的显示，原题仍然记在变式题里
      setVariants((prev) => ({
        ...prev,
        [problem.id]: {
          form: formFromDraft(result.items[0]),
          difficulty: result.difficulty,
          original: problem,
        },
      }));
      setNotice(
        `已把 #${problem.id} 的显示换成「${DIFFICULTY_LABELS[result.difficulty]}」变式题${
          replacing ? '（替换了上一道变式）' : ''
        }，原题没删，可点「查看原题」对照`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AI_NOT_CONFIGURED') {
        setNotConfigured(true);
      }
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(null);
    }
  }

  /** 还原成原题显示（变式题只在页面上，不入库） */
  function restoreOriginal(id: number): void {
    setVariants((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOpenOriginals((prev) => ({ ...prev, [id]: false }));
  }

  function toggleOriginal(id: number): void {
    setOpenOriginals((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  /** 打印当前学科下的全部未掌握错题，不是 AI 生成的新题 */
  async function printFiltered(): Promise<void> {
    setPrinting(true);
    setError('');
    try {
      const collected: Problem[] = [];
      let offset = 0;
      for (let page = 0; page < 20; page += 1) {
        const params = new URLSearchParams({ limit: '200', offset: String(offset) });
        if (subject) params.set('subject', subject);
        params.set('mastered', '0');
        params.set('scope', 'weekly');
        const result = await api<ProblemListResponse>(`/api/problems?${params.toString()}`);
        collected.push(...result.items);
        offset += result.items.length;
        if (result.items.length === 0 || offset >= result.total) break;
      }
      if (collected.length === 0) {
        setError('当前学科没有题目，没法打印');
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
          <span className="muted">{loading ? '加载中…' : `共 ${total} 道`}</span>
        </div>
        <p className="muted small practice-hint">
          只显示两类题：① 本周一到现在新录入、还没再错过的题；② 上一次错误发生在上周（周一到周日）的题。可按学科筛选。「AI
          重新生成」会就地把这道题换成变式题（原错题仍保留，可点「查看原题」对照、随时还原）；「打印试卷」打印的是下面列出的全部错题（答案可选）。
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

      {!loading && items.length === 0 && (
        <div className="empty">
          <p>这个范围里没有错题。</p>
          <p className="muted">换个时间范围或年级，或者先去「加题目」录几道。</p>
        </div>
      )}

      <div className="list">
        {items.map((problem) => {
          const variant = variants[problem.id];
          const originalOpen = Boolean(openOriginals[problem.id]);
          const options = variant ? parseOptionsText(variant.form.optionsText) : problem.options;
          return (
            <article className={`card practice-item${variant ? ' is-variant' : ''}`} key={problem.id}>
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
                  {variant && (
                    <span className="chip chip--variant">变式 · {DIFFICULTY_LABELS[variant.difficulty]}</span>
                  )}
                </div>
                <span className="muted small mono">
                  #{problem.id} · {latestWrongLabel(problem)}
                </span>
              </header>

              <p className="stem">{variant ? variant.form.stem : problem.stem}</p>
              {options.length > 0 && (
                <ul className="options">
                  {options.map((option) => (
                    <li key={option.key}>
                      <b>{option.key}.</b> {option.text}
                    </li>
                  ))}
                </ul>
              )}

              {variant && (
                <details className="variant-answer">
                  <summary>查看答案与解析</summary>
                  <p className="answer">
                    <span className="label">答案</span> {variant.form.answer}
                  </p>
                  {variant.form.analysis && <p className="analysis">{variant.form.analysis}</p>}
                </details>
              )}

              {variant && originalOpen && (
                <div className="original-reveal">
                  <div className="original-reveal__head">原题 #{problem.id}</div>
                  <p className="stem">{variant.original.stem}</p>
                  {variant.original.options.length > 0 && (
                    <ul className="options">
                      {variant.original.options.map((option) => (
                        <li key={option.key}>
                          <b>{option.key}.</b> {option.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
                  {generating === problem.id ? '生成中…' : variant ? '换一道变式' : 'AI 重新生成'}
                </button>
                {variant && (
                  <>
                    <button type="button" className="btn btn--sm" onClick={() => toggleOriginal(problem.id)}>
                      {originalOpen ? '收起原题' : '查看原题'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => restoreOriginal(problem.id)}
                    >
                      还原原题
                    </button>
                  </>
                )}
                {problem.wrongCount > 0 && <span className="muted small">错过 {problem.wrongCount} 次</span>}
              </footer>
            </article>
          );
        })}
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
