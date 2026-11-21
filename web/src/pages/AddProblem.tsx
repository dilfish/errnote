import { useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { ProblemCard } from '../components/ProblemCard';
import { compressImage } from '../compress';
import { createCropper, type Cropper } from '../crop';
import { emptyForm, formFromDraft, formToPayload, type ProblemForm } from '../form';
import type { Health, Problem, ProblemDraft } from '../types';
import { MAX_DRAFT_ITEMS } from '../types';

type DraftOrigin = 'image' | 'text' | 'manual';

type DraftState = {
  form: ProblemForm;
  saving?: boolean;
  error?: string;
  /** 已入库的 id；有值时卡片可以折叠成一行 */
  savedId?: number;
  collapsed?: boolean;
  origin: DraftOrigin;
  /** 来自哪张整图：重新识别同一张图时用来替换旧结果、显示「整张原图」 */
  originImage?: string | null;
};

type ErrorState = { message: string; hint?: string; detail?: string };

type Props = {
  health: Health | null;
  onSaved: () => void;
};

function toErrorState(error: unknown): ErrorState {
  if (error instanceof ApiError) {
    return { message: error.message, hint: error.hint || undefined, detail: error.detail || undefined };
  }
  return { message: error instanceof Error ? error.message : '操作失败' };
}

export function AddProblem({ health, onSaved }: Props) {
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<ErrorState | null>(null);
  const [model, setModel] = useState('');
  const [splitNote, setSplitNote] = useState('');
  const [drafts, setDrafts] = useState<DraftState[]>([]);
  const [savedNotice, setSavedNotice] = useState('');
  const [testing, setTesting] = useState<'' | 'text' | 'vision'>('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const visionReady = health?.ai.vision.ready ?? true;
  const textReady = health?.ai.text.ready ?? true;
  const headerNames = health?.ai.vision.headerNames ?? [];

  function patchDraft(key: string, patch: Partial<DraftState>): void {
    setDrafts((prev) => prev.map((item) => (item.form.key === key ? { ...item, ...patch } : item)));
  }

  function patchForm(key: string, patch: Partial<ProblemForm>): void {
    setDrafts((prev) =>
      prev.map((item) => (item.form.key === key ? { ...item, form: { ...item.form, ...patch } } : item)),
    );
  }

  function toggleCollapse(key: string): void {
    setDrafts((prev) =>
      prev.map((item) => (item.form.key === key ? { ...item, collapsed: !item.collapsed } : item)),
    );
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      setPreview(compressed.dataUrl);
      const uploaded = await api<{ path: string }>('/api/images', {
        method: 'POST',
        body: { dataUrl: compressed.dataUrl },
      });
      setImagePath(uploaded.path);
      setUploading(false);
      await runExtract({ imagePath: uploaded.path, imageDataUrl: compressed.dataUrl });
    } catch (err) {
      setUploading(false);
      setError(toErrorState(err));
    }
  }

  /** 把 AI 结果转成可编辑卡片；图片里有几道题就按 bbox 切几张单题小图 */
  async function buildDrafts(
    items: ProblemDraft[],
    options: { origin: DraftOrigin; fullImage: string | null; sourceImage: string | null },
  ): Promise<DraftState[]> {
    const { origin, fullImage, sourceImage } = options;
    // 几十道题时原图只解码一次，避免每道题都重新读图
    let cropper: Cropper | null = null;
    if (origin === 'image' && sourceImage) {
      try {
        cropper = await createCropper(sourceImage);
      } catch {
        cropper = null;
      }
    }
    const drafts: DraftState[] = [];
    for (const item of items) {
      let path = item.imagePath ?? fullImage;
      if (cropper && item.bbox) {
        try {
          const cropped = cropper(item.bbox);
          if (cropped) {
            const uploaded = await api<{ path: string }>('/api/images', {
              method: 'POST',
              body: { dataUrl: cropped },
            });
            path = uploaded.path;
          }
        } catch {
          // 切图/上传失败就用整张原图，不影响编辑
          path = fullImage;
        }
      }
      drafts.push({
        form: formFromDraft({ ...item, imagePath: path ?? null }),
        origin,
        originImage: origin === 'image' ? fullImage : null,
      });
    }
    return drafts;
  }

  async function runExtract(
    input: { imagePath?: string; text?: string; imageDataUrl?: string } = {},
  ): Promise<void> {
    const payload: Record<string, string> = {};
    const useImage = input.imagePath ?? imagePath;
    if (useImage) payload.imagePath = useImage;
    const useText = input.text?.trim() || '';
    if (useText) payload.text = useText;
    if (!payload.imagePath && !payload.text) {
      setError({ message: '请先拍照上传，或输入题目文字' });
      return;
    }
    const sourceImage = useImage ? input.imageDataUrl ?? preview : null;
    setError(null);
    setSplitNote('');
    setExtracting(true);
    try {
      const result = await api<{ items: ProblemDraft[]; model: string; imagePath: string | null }>(
        '/api/ai/extract',
        { method: 'POST', body: payload, timeoutMs: 300000 },
      );
      setModel(result.model);
      if (result.items.length === 0) {
        setError({ message: 'AI 没有识别出题目，换张更清晰的图片，或改用手动输入' });
        if (!useImage) setDrafts([]);
        return;
      }
      const origin: DraftOrigin = useImage ? 'image' : 'text';
      setSplitting(Boolean(useImage && sourceImage && result.items.some((item) => item.bbox)));
      const forms = await buildDrafts(result.items, {
        origin,
        fullImage: useImage ?? null,
        sourceImage,
      });
      setSplitting(false);
      const splitCount = forms.filter((item) => item.form.imagePath !== useImage).length;
      if (result.items.length > 1) {
        setSplitNote(
          splitCount > 0
            ? `识别出 ${result.items.length} 道题，已自动切成 ${splitCount} 张单题小图（一次最多识别 ${MAX_DRAFT_ITEMS} 道）`
            : `识别出 ${result.items.length} 道题：没有拿到切图位置，暂时共用整张原图`,
        );
      } else {
        setSplitNote('');
      }
      // 重新识别同一张图时，替换掉它上一轮还没保存的结果，避免重复
      setDrafts((prev) => {
        const kept =
          origin === 'image' && useImage
            ? prev.filter(
                (item) =>
                  !(item.origin === 'image' && item.originImage === useImage && item.savedId === undefined && !item.saving),
              )
            : prev;
        return [...kept, ...forms];
      });
    } catch (err) {
      setError(toErrorState(err));
    } finally {
      setSplitting(false);
      setExtracting(false);
    }
  }

  async function saveDraft(key: string): Promise<boolean> {
    const current = drafts.find((item) => item.form.key === key);
    if (!current) return false;
    if (current.collapsed) return true;
    if (!current.form.stem.trim()) {
      patchDraft(key, { error: '题干不能为空，请先填写题目内容' });
      return false;
    }
    if (!current.form.answer.trim()) {
      patchDraft(key, { error: '答案不能为空：不会做可以先点「AI 整理」，或先写「待解」' });
      return false;
    }
    patchDraft(key, { saving: true, error: undefined });
    try {
      const payload = formToPayload(current.form);
      payload.source = current.savedId !== undefined
        ? '手动编辑'
        : current.origin === 'image'
          ? '拍照识别'
          : '手动录入';
      let saved: Problem;
      if (current.form.id) {
        const result = await api<{ item: Problem }>(`/api/problems/${current.form.id}`, {
          method: 'PUT',
          body: payload,
        });
        saved = result.item;
      } else {
        const result = await api<{ item: Problem }>('/api/problems', { method: 'POST', body: payload });
        saved = result.item;
      }
      // 保存成功就收成一行摘要，还能点「继续编辑」再改
      setDrafts((prev) =>
        prev.map((item) =>
          item.form.key === key
            ? {
                ...item,
                saving: false,
                error: undefined,
                savedId: saved.id,
                collapsed: true,
                form: { ...item.form, id: saved.id },
              }
            : item,
        ),
      );
      setSavedNotice(`已保存 #${saved.id}（${saved.subject || '未标学科'}）${saved.stem.slice(0, 24)}…`);
      onSaved();
      return true;
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === 'VALIDATION_FAILED' ? err.message : toErrorState(err).message;
      patchDraft(key, { saving: false, error: message });
      return false;
    }
  }

  const pending = drafts.filter((item) => !(item.savedId !== undefined && item.collapsed));
  const savedCount = drafts.length - pending.length;

  async function saveAll(): Promise<void> {
    if (pending.length === 0) return;
    let saved = 0;
    let failed = 0;
    for (const item of pending) {
      const ok = await saveDraft(item.form.key);
      if (ok) saved += 1;
      else failed += 1;
    }
    setSavedNotice(
      failed === 0
        ? `已保存 ${saved} 道题`
        : `已保存 ${saved} 道，${failed} 道没存上，请看每张卡片上的提示`,
    );
  }

  async function runTest(mode: 'text' | 'vision'): Promise<void> {
    setTesting(mode);
    setTestResult(null);
    try {
      const result = await api<{ model: string; latencyMs: number; sample: string }>('/api/ai/test', {
        method: 'POST',
        body: { mode },
        timeoutMs: 90000,
      });
      const label = mode === 'text' ? '文本模型' : '识图模型';
      setTestResult({
        ok: true,
        text: `${label}连接正常：${result.model}，${result.latencyMs}ms，返回「${result.sample.slice(0, 40)}」`,
      });
      onSaved();
    } catch (err) {
      const state = toErrorState(err);
      setTestResult({ ok: false, text: `${state.message}${state.hint ? ` ｜ ${state.hint}` : ''}` });
    } finally {
      setTesting('');
    }
  }

  return (
    <div className="page">
      <section className="card ai-panel">
        <div className="ai-panel__main">
          <div className="ai-line">
            <span className="muted small">文本模型</span>
            <b>{health?.ai.text.model || '未配置'}</b>
            <span className={`dot ${health?.ai.text.ready ? 'dot--ok' : 'dot--off'}`} />
          </div>
          <div className="ai-line">
            <span className="muted small">识图模型</span>
            <b>{health?.ai.vision.model || '未配置'}</b>
            <span className={`dot ${health?.ai.vision.ready ? 'dot--ok' : 'dot--off'}`} />
          </div>
          {headerNames.length > 0 && (
            <p className="muted small ai-panel__headers">自定义请求头：{headerNames.join('、')}</p>
          )}
        </div>
        <div className="ai-panel__actions">
          <button type="button" className="btn btn--sm" onClick={() => void runTest('text')} disabled={Boolean(testing)}>
            {testing === 'text' ? '测试中…' : '测试文本'}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => void runTest('vision')} disabled={Boolean(testing)}>
            {testing === 'vision' ? '测试中…' : '测试识图'}
          </button>
        </div>
        {testResult && (
          <p className={`test-result small ${testResult.ok ? 'test-result--ok' : 'test-result--fail'}`}>
            {testResult.text}
          </p>
        )}
      </section>

      {!textReady && (
        <div className="alert alert--warn">
          还没配置 AI：打开 <code>{health?.ai.configPath}</code>，把 <code>apiKey</code> 填上（保存即生效，不用重启）。
          拍照识别还需要配置 <code>visionModel</code>。
        </div>
      )}
      {textReady && !visionReady && (
        <div className="alert alert--warn">
          文本模型已就绪，但还没有视觉模型：拍照识别会失败。请在 <code>visionModel</code> 里填一个能看图的模型（如
          qwen-vl-max），或直接手打文字让 AI 整理。
        </div>
      )}

      <section className="card">
        <h2>
          <span className="step">1</span> 拍照 / 上传题目
        </h2>
        <p className="muted">
          一张照片里有几道题也没关系：AI 会自动按题号把它们切开，每道题一张小图，逐题核对、逐题保存。
        </p>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => cameraInput.current?.click()}>
            拍照
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            选图片
          </button>
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {preview && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => void runExtract({ imagePath: imagePath ?? undefined })}
                disabled={extracting}
              >
                {extracting ? '识别中…' : '重新识别这张图'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setPreview(null);
                  setImagePath(null);
                }}
                disabled={extracting}
              >
                移除图片
              </button>
            </>
          )}
        </div>
        {uploading && <p className="muted">图片压缩上传中…</p>}
        {preview && (
          <div className="preview">
            <img src={preview} alt="待识别的题目" />
          </div>
        )}
        {extracting && <p className="loading">AI 正在识别题目、按题切分、补全答案和知识点…</p>}
        {splitting && <p className="loading">正在按题目切图…</p>}
      </section>

      <section className="card">
        <h2>
          <span className="step">2</span> 或者直接输入文字
        </h2>
        <textarea
          rows={4}
          value={text}
          placeholder="把题目文字粘贴到这里，AI 会整理题干、补全答案并标出知识点"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={extracting || !text.trim()}
            onClick={() => void runExtract({ text })}
          >
            {extracting ? '整理中…' : 'AI 整理文字'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              setDrafts((prev) => [
                ...prev,
                { form: { ...emptyForm(), imagePath: imagePath ?? null }, origin: 'manual' },
              ])
            }
          >
            不用 AI，手动填一道
          </button>
          {imagePath && !preview && <span className="muted">已上传图片</span>}
        </div>
      </section>

      {error && (
        <div className="alert alert--error">
          <p className="alert__title">{error.message}</p>
          {error.hint && <p className="alert__hint">💡 {error.hint}</p>}
          {error.detail && (
            <details>
              <summary>查看接口原始返回</summary>
              <pre>{error.detail}</pre>
            </details>
          )}
        </div>
      )}

      {savedNotice && (
        <div className="alert alert--ok" onClick={() => setSavedNotice('')}>
          {savedNotice}
        </div>
      )}

      {drafts.length > 0 && (
        <section className="page">
          <div className="section-head">
            <h2>
              <span className="step">3</span> 核对后入库
              {model && <span className="muted"> · {model}</span>}
            </h2>
            <span className="muted small">
              待保存 {pending.length} 道{savedCount > 0 ? ` · 已保存 ${savedCount} 道` : ''}
            </span>
            {pending.length > 1 && (
              <button type="button" className="btn" onClick={() => void saveAll()} disabled={extracting || splitting}>
                全部保存（{pending.length} 道）
              </button>
            )}
          </div>
          {splitNote && <p className="muted small">{splitNote}</p>}
          {drafts.length > 1 && (
            <div className="draft-jump">
              {drafts.map((draft, index) => (
                <button
                  key={draft.form.key}
                  type="button"
                  className={`draft-jump__item${draft.savedId !== undefined ? ' is-done' : ''}`}
                  onClick={() => {
                    document
                      .getElementById(`draft-${draft.form.key}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {index + 1}. {draft.form.subject || '未标学科'}
                  {draft.savedId !== undefined ? ' ✓' : ''}
                </button>
              ))}
            </div>
          )}
          {drafts.map((draft, index) => (
            <div className="draft-slot" id={`draft-${draft.form.key}`} key={draft.form.key}>
              <ProblemCard
                form={draft.form}
                title={drafts.length > 1 ? `第 ${index + 1} 题` : '识别结果'}
                saving={draft.saving}
                savedId={draft.savedId}
                collapsed={draft.collapsed}
                onToggleCollapse={() => toggleCollapse(draft.form.key)}
                error={draft.error}
                sourceImage={draft.originImage ?? null}
                onChange={(patch) => patchForm(draft.form.key, patch)}
                onSave={() => void saveDraft(draft.form.key)}
                onDiscard={() => setDrafts((prev) => prev.filter((item) => item.form.key !== draft.form.key))}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
