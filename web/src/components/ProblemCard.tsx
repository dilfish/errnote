import type { ProblemForm } from '../form';
import { splitKnowledge } from '../form';
import { GRADES, PROBLEM_TYPES, SEMESTERS, SUBJECTS, UNITS } from '../types';

type Props = {
  form: ProblemForm;
  title?: string;
  saving?: boolean;
  saved?: boolean;
  /** 已入库的题目 id（加题目页保存后用于折叠展示） */
  savedId?: number;
  /** 折叠成一行摘要，点「继续编辑」展开 */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  error?: string;
  onChange: (patch: Partial<ProblemForm>) => void;
  onSave: () => void;
  onDiscard?: () => void;
  onDelete?: () => void;
  imagePreview?: string | null;
  /** 切分前的整张原图，方便对照 */
  sourceImage?: string | null;
};

export function ProblemCard({
  form,
  title,
  saving,
  saved,
  savedId,
  collapsed,
  onToggleCollapse,
  error,
  onChange,
  onSave,
  onDiscard,
  onDelete,
  imagePreview,
  sourceImage,
}: Props) {
  const knowledge = splitKnowledge(form.knowledgeText);
  const preview = imagePreview ?? form.imagePath;
  const fullImage = sourceImage && sourceImage !== preview ? sourceImage : null;
  // 老数据/AI 给出列表外的值时，保留原值避免被清空
  const gradeOptions = form.grade && !GRADES.includes(form.grade) ? [form.grade, ...GRADES] : GRADES;
  const unitOptions = form.unit && !UNITS.includes(form.unit) ? [form.unit, ...UNITS] : UNITS;
  const semesterOptions =
    form.semester && !SEMESTERS.includes(form.semester) ? [form.semester, ...SEMESTERS] : SEMESTERS;
  const typeOptions =
    form.problemType && !PROBLEM_TYPES.includes(form.problemType)
      ? [form.problemType, ...PROBLEM_TYPES]
      : PROBLEM_TYPES;

  if (collapsed) {
    const summary = form.stem.replace(/\s+/g, ' ').trim();
    return (
      <section className="card problem-card is-saved problem-card--collapsed">
        <header className="problem-card__head">
          <h3>{title ?? (savedId ? `#${savedId}` : '已保存的题目')}</h3>
          <div className="problem-card__head-right">
            {savedId !== undefined && <span className="badge badge--ok">已保存 #{savedId}</span>}
            {onToggleCollapse && (
              <button type="button" className="btn btn--sm" onClick={onToggleCollapse}>
                继续编辑
              </button>
            )}
          </div>
        </header>
        <p className="problem-card__summary">
          {form.subject && <span className="chip chip--subject">{form.subject}</span>}
          <span>
            {summary ? `${summary.slice(0, 80)}${summary.length > 80 ? '…' : ''}` : '（题干为空）'}
          </span>
        </p>
      </section>
    );
  }

  return (
    <section className={`card problem-card${saved ? ' is-saved' : ''}`}>
      <header className="problem-card__head">
        <h3>{title ?? (form.id ? `编辑 #${form.id}` : '待保存的题目')}</h3>
        <div className="problem-card__head-right">
          {savedId !== undefined ? (
            <span className="badge badge--ok">已保存 #{savedId}</span>
          ) : (
            <>
              {form.id && <span className="badge badge--id">#{form.id}</span>}
              {saved && <span className="badge badge--ok">已入库</span>}
            </>
          )}
        </div>
      </header>

      <div className="problem-card__body">
        {(preview || fullImage) && (
          <div className="problem-card__media">
            {preview && (
              <a className="thumb" href={preview} target="_blank" rel="noreferrer">
                <img src={preview} alt="题目图片" />
                <span>{fullImage ? '本题切图' : '查看原图'}</span>
              </a>
            )}
            {fullImage && (
              <a className="thumb thumb--sm" href={fullImage} target="_blank" rel="noreferrer">
                <img src={fullImage} alt="整张原图" />
                <span>整张原图</span>
              </a>
            )}
          </div>
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

        <div className="field-row">
          <label className="field field--sm">
            <span>学期</span>
            <select value={form.semester} onChange={(event) => onChange({ semester: event.target.value })}>
              <option value="">未填</option>
              {semesterOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--sm">
            <span>单元</span>
            <select value={form.unit} onChange={(event) => onChange({ unit: event.target.value })}>
              <option value="">未填</option>
              {unitOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--sm">
            <span>题型</span>
            <select value={form.problemType} onChange={(event) => onChange({ problemType: event.target.value })}>
              <option value="">未填</option>
              {typeOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--sm">
            <span>状态</span>
            <select
              value={form.mastered ? '1' : '0'}
              onChange={(event) => onChange({ mastered: event.target.value === '1' })}
            >
              <option value="0">未掌握</option>
              <option value="1">已掌握</option>
            </select>
          </label>
        </div>

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
        {savedId !== undefined && onToggleCollapse && (
          <button type="button" className="btn btn--ghost" onClick={onToggleCollapse} disabled={saving}>
            收起
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
