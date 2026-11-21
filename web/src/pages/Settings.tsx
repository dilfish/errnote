import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Difficulty, PromptBook, PromptTrip } from '../types';

type Payload = {
  difficulties: { key: Difficulty; label: string }[];
  prompts: PromptBook;
  defaults: PromptBook;
};

const PLACEHOLDERS = ['{stem}', '{options}', '{answer}', '{analysis}', '{knowledgePoints}', '{grade}', '{subject}'];

export function Settings() {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<PromptBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<string>('数学');

  useEffect(() => {
    api<Payload>('/api/prompts')
      .then((result) => {
        setData(result);
        setDraft(result.prompts);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const order = useMemo(() => {
    if (!data) return [];
    const keys = Object.keys(data.prompts);
    return ['通用', ...keys.filter((key) => key !== '通用')].filter((key) => keys.includes(key));
  }, [data]);

  function update(subject: string, difficulty: Difficulty, value: string): void {
    setDraft((prev) => {
      if (!prev) return prev;
      const trip: PromptTrip = { ...prev[subject], [difficulty]: value };
      return { ...prev, [subject]: trip };
    });
    setNotice('');
  }

  function resetSubject(subject: string): void {
    if (!data) return;
    setDraft((prev) => (prev ? { ...prev, [subject]: { ...data.defaults[subject] } } : prev));
    setNotice(`「${subject}」已恢复默认，记得点保存`);
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    try {
      await api('/api/prompts', { method: 'PUT', body: { prompts: draft } });
      setNotice('已保存，练习页立即生效');
    } catch (error) {
      setNotice(error instanceof Error ? `保存失败：${error.message}` : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">加载中…</p>;
  if (!data || !draft) return <div className="alert alert--error">{notice || '加载失败'}</div>;

  return (
    <div className="page">
      <section className="card">
        <h2>重新出题的提示词</h2>
        <p className="muted small">
          每个学科分「容易 / 中等 / 难」三套提示词，错题练习页会拿它去要求 AI 改写原题。
          可用占位符：{PLACEHOLDERS.map((item) => <code key={item}>{item}</code>)}，会被替换成原题内容。
          「通用」是其他学科没单独配置时的兜底。
        </p>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存全部'}
          </button>
          {notice && <span className="test-result small">{notice}</span>}
        </div>
      </section>

      {order.map((subject) => (
        <details
          className="card prompt-card"
          key={subject}
          open={open === subject}
          onToggle={(event) => {
            const element = event.currentTarget as HTMLDetailsElement;
            if (element.open) setOpen(subject);
          }}
        >
          <summary>
            {subject}
            {subject === '通用' && <span className="muted small"> · 其他学科默认使用</span>}
          </summary>
          {data.difficulties.map((level) => (
            <label className="field" key={level.key}>
              <span>{level.label}</span>
              <textarea
                rows={3}
                value={draft[subject]?.[level.key] ?? ''}
                onChange={(event) => update(subject, level.key, event.target.value)}
              />
            </label>
          ))}
          <div className="row">
            <button type="button" className="btn btn--sm" onClick={() => resetSubject(subject)}>
              恢复默认
            </button>
          </div>
        </details>
      ))}
    </div>
  );
}
