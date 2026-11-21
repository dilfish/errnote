import type { ProblemForm } from '../form';
import { splitKnowledge } from '../form';
import { GRADES, SUBJECTS } from '../types';

type Props = {
  form: ProblemForm;
  title?: string;
  saving?: boolean;
  saved?: boolean;
  error?: string;
  onChange: (patch: Partial<ProblemForm>) => void;
  onSave: () => void;
  onDiscard?: () => void;
  onDelete?: () => void;
  imagePreview?: string | null;
};

export function ProblemCard({
  form,
  title,
  saving,
  saved,
  error,
  onChange,
  onSave,
  onDiscard,
  onDelete,
  imagePreview,
}: Props) {
  const knowledge = splitKnowledge(form.knowledgeText);
  const preview = imagePreview ?? form.imagePath;
  // 老数据/AI 给出列表外的年级时，保留原值避免被清空
  const gradeOptions = form.grade && !GRADES.includes(form.grade) ? [form.grade, ...GRADES] : GRADES;

  return (
    <section className={`card problem-card${saved ? ' is-saved' : ''}`}>
      <header className="problem-card__head">
        <h3>{title ?? (form.id ? `编辑 #${form.id}` : '待保存的题目')}</h3>
        <div className="problem-card__head-right">
          {form.id && <span className="badge badge--id">#{form.id}</span>}
          {saved && <span className="badge badge--ok">已入库</span>}
        </div>
      </header>

      <div className="problem-card__body">
        {preview && (
          <a className="thumb" href={preview} target="_blank" rel="noreferrer">
            <img src={preview} alt="题目图片" />
            <span>查看原图</span>
          </a>
        )}

        <div className="field-row">
          <label className="field field--sm">
            <span>学科</span>
            <input
              list="subject-options"
              value={form.subject}
              placeholder="如 数学"
              onChange={(event) => onChange({ subject: event.target.value })}
            />
          </label>
          <label className="field field--sm">
            <span>年级</span>
            <select
              value={form.grade}
              onChange={(event) => onChange({ grade: event.target.value })}
            >
              <option value="">未填</option>
              {gradeOptions.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </label>
        </div>
        <datalist id="subject-options">
          {SUBJECTS.map((subject) => (
            <option key={subject} value={subject} />
          ))}
        </datalist>

        <label className="field">
          <span>题干</span>
          <textarea
            rows={5}
            value={form.stem}
            placeholder="题目内容"
            onChange={(event) => onChange({ stem: event.target.value })}
          />
        </label>

        <label className="field">
          <span>选项（每行一个，非选择题留空）</span>
          <textarea
            rows={4}
            value={form.optionsText}
            placeholder={'A. ...\nB. ...\nC. ...\nD. ...'}
            onChange={(event) => onChange({ optionsText: event.target.value })}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>答案</span>
            <textarea
              rows={2}
              value={form.answer}
              placeholder="正确答案"
              onChange={(event) => onChange({ answer: event.target.value })}
            />
          </label>
          <label className="field">
            <span>知识点（逗号分隔）</span>
            <input
              value={form.knowledgeText}
              placeholder="如 一元二次方程判别式，根的个数"
              onChange={(event) => onChange({ knowledgeText: event.target.value })}
            />
            {knowledge.length > 0 && (
              <div className="chips">
                {knowledge.map((item) => (
                  <span className="chip" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            )}
          </label>
        </div>

        <label className="field">
          <span>解析</span>
          <textarea
            rows={3}
            value={form.analysis}
            placeholder="解题思路"
            onChange={(event) => onChange({ analysis: event.target.value })}
          />
        </label>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      <footer className="problem-card__foot">
        <button type="button" className="btn btn--primary" onClick={onSave} disabled={saving}>
          {saving ? '保存中…' : form.id ? '保存修改' : '保存到错题本'}
        </button>
        {onDiscard && (
          <button type="button" className="btn" onClick={onDiscard} disabled={saving}>
            丢弃
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn btn--danger" onClick={onDelete} disabled={saving}>
            删除
          </button>
        )}
      </footer>
    </section>
  );
}
