import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api';
import { ProblemCard } from '../components/ProblemCard';
import { formFromProblem, formToPayload, type ProblemForm } from '../form';
import type { Problem, ProblemListResponse } from '../types';

const PAGE_SIZE = 20;

type Props = {
  onChanged: () => void;
};

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function Library({ onChanged }: Props) {
  const [items, setItems] = useState<Problem[]>([]);
  const [total, setTotal] = useState(0);
  const [subjects, setSubjects] = useState<{ subject: string; n: number }[]>([]);
  const [grades, setGrades] = useState<{ grade: string; n: number }[]>([]);
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ form: ProblemForm; saving?: boolean; error?: string } | null>(null);

  const load = useCallback(
    async (options: { append?: boolean } = {}) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(options.append ? items.length : 0),
        });
        if (q.trim()) params.set('q', q.trim());
        if (subject) params.set('subject', subject);
        if (grade) params.set('grade', grade);
        const result = await api<ProblemListResponse>(`/api/problems?${params.toString()}`);
        setTotal(result.total);
        setSubjects(result.subjects);
        setGrades(result.grades);
        setItems((prev) => (options.append ? [...prev, ...result.items] : result.items));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, subject, grade, items.length],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [q, subject, grade]);

  async function remove(problem: Problem): Promise<void> {
    if (!window.confirm(`确定删除这道题？\n\n${problem.stem.slice(0, 60)}`)) return;
    try {
      await api(`/api/problems/${problem.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((item) => item.id !== problem.id));
      setTotal((prev) => Math.max(0, prev - 1));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }

  async function bumpWrong(problem: Problem): Promise<void> {
    try {
      const result = await api<{ item: Problem }>(`/api/problems/${problem.id}/wrong`, { method: 'POST' });
      setItems((prev) => prev.map((item) => (item.id === problem.id ? result.item : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function toggleMastered(problem: Problem): Promise<void> {
    try {
      const result = await api<{ item: Problem }>(`/api/problems/${problem.id}/mastered`, {
        method: 'POST',
        body: { mastered: !problem.mastered },
      });
      setItems((prev) => prev.map((item) => (item.id === problem.id ? result.item : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function saveEditing(): Promise<void> {
    if (!editing) return;
    const form = editing.form;
    if (!form.stem.trim()) {
      setEditing({ ...editing, error: '题干不能为空' });
      return;
    }
    if (!form.answer.trim()) {
      setEditing({ ...editing, error: '答案不能为空：不会做可以先写「待解」' });
      return;
    }
    setEditing({ ...editing, saving: true, error: undefined });
    try {
      const payload = formToPayload(form);
      const result = await api<{ item: Problem }>(`/api/problems/${form.id}`, { method: 'PUT', body: payload });
      setItems((prev) => prev.map((item) => (item.id === result.item.id ? result.item : item)));
      setEditing(null);
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '保存失败';
      setEditing({ ...editing, saving: false, error: message });
    }
  }

  const subjectOptions = useMemo(() => subjects.map((item) => item.subject), [subjects]);
  const gradeOptions = useMemo(() => grades.map((item) => item.grade), [grades]);

  return (
    <div className="page">
      <section className="card">
        <div className="filters">
          <input
            className="search"
            value={q}
            placeholder="搜索题干、答案、知识点…"
            onChange={(event) => setQ(event.target.value)}
          />
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="">全部学科</option>
            {subjectOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={grade} onChange={(event) => setGrade(event.target.value)}>
            <option value="">全部年级</option>
            {gradeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <span className="muted">共 {total} 道</span>
        </div>
      </section>

      {editing && !items.some((item) => item.id === editing.form.id) && (
        <ProblemCard
          form={editing.form}
          title="编辑题目（不在当前筛选结果里）"
          saving={editing.saving}
          error={editing.error}
          onChange={(patch) => setEditing({ ...editing, form: { ...editing.form, ...patch } })}
          onSave={() => void saveEditing()}
          onDiscard={() => setEditing(null)}
        />
      )}

      {error && <div className="alert alert--error">{error}</div>}
      {loading && items.length === 0 && <p className="muted">加载中…</p>}

      {!loading && items.length === 0 && (
        <div className="empty">
          <p>还没有题目。</p>
          <p className="muted">去「加题目」页拍一张，或者粘贴文字让 AI 整理。</p>
        </div>
      )}

      <div className="list">
        {items.map((problem) => {
          if (editing && editing.form.id === problem.id) {
            return (
              <ProblemCard
                key={problem.id}
                form={editing.form}
                title={`编辑 #${problem.id}`}
                saving={editing.saving}
                error={editing.error}
                onChange={(patch) => setEditing({ ...editing, form: { ...editing.form, ...patch } })}
                onSave={() => void saveEditing()}
                onDiscard={() => setEditing(null)}
              />
            );
          }
          return (
          <article className="card problem-item" key={problem.id}>
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
                {problem.mastered && <span className="badge badge--ok">已掌握</span>}
              </div>
              <span className="muted mono">#{problem.id} · {formatDate(problem.createdAt)}</span>
            </header>

            <div className="problem-item__body">
              {problem.imagePath && (
                <a className="thumb thumb--sm" href={problem.imagePath} target="_blank" rel="noreferrer">
                  <img src={problem.imagePath} alt="原题" />
                </a>
              )}
              <div>
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
                {problem.answer && (
                  <p className="answer">
                    <span className="label">答案</span> {problem.answer}
                  </p>
                )}
                {problem.analysis && (
                  <details>
                    <summary>解析</summary>
                    <p>{problem.analysis}</p>
                  </details>
                )}
                {problem.wrongCount > 0 && (
                  <p className="muted small">
                    错过 {problem.wrongCount} 次
                    {problem.wrongTimes.length > 0 &&
                      `（最近：${problem.wrongTimes.slice(0, 3).map(shortDate).join('、')}）`}
                  </p>
                )}
              </div>
            </div>

            <footer className="problem-item__foot">
              <button type="button" className="btn btn--sm" onClick={() => void bumpWrong(problem)}>
                又错了 +1
              </button>
              <button type="button" className="btn btn--sm" onClick={() => void toggleMastered(problem)}>
                {problem.mastered ? '标记未掌握' : '标记已掌握'}
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setEditing({ form: formFromProblem(problem) })}
              >
                编辑
              </button>
              <button type="button" className="btn btn--sm btn--danger" onClick={() => void remove(problem)}>
                删除
              </button>
            </footer>
          </article>
          );
        })}
      </div>

      {items.length < total && (
        <div className="center">
          <button type="button" className="btn" onClick={() => void load({ append: true })} disabled={loading}>
            {loading ? '加载中…' : `加载更多（还有 ${total - items.length} 道）`}
          </button>
        </div>
      )}
    </div>
  );
}
