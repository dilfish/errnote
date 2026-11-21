import { useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { ProblemCard } from '../components/ProblemCard';
import { compressImage } from '../compress';
import { emptyForm, formFromDraft, formToPayload, type ProblemForm } from '../form';
import type { Health, Problem, ProblemDraft } from '../types';

type DraftState = {
  form: ProblemForm;
  saving?: boolean;
  error?: string;
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
  const [text, setText] = useState('');
  const [error, setError] = useState<ErrorState | null>(null);
  const [model, setModel] = useState('');
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
      await runExtract({ imagePath: uploaded.path });
    } catch (err) {
      setUploading(false);
      setError(toErrorState(err));
    }
  }

  async function runExtract(input: { imagePath?: string; text?: string } = {}): Promise<void> {
    const payload: Record<string, string> = {};
    const useImage = input.imagePath ?? imagePath;
    if (useImage) payload.imagePath = useImage;
    const useText = input.text?.trim() || '';
    if (useText) payload.text = useText;
    if (!payload.imagePath && !payload.text) {
      setError({ message: '请先拍照上传，或输入题目文字' });
      return;
    }
    setError(null);
    setExtracting(true);
    try {
      const result = await api<{ items: ProblemDraft[]; model: string; imagePath: string | null }>(
        '/api/ai/extract',
        { method: 'POST', body: payload, timeoutMs: 150000 },
      );
      setModel(result.model);
      if (result.items.length === 0) {
        setError({ message: 'AI 没有识别出题目，换张更清晰的图片，或改用手动输入' });
        if (!useImage) setDrafts([]);
        return;
      }
      const forms = result.items.map((item, index) => ({
        form: formFromDraft({
          ...item,
          imagePath: useImage && index === 0 ? useImage : item.imagePath,
        }),
      }));
      setDrafts((prev) => [...prev, ...forms]);
    } catch (err) {
      setError(toErrorState(err));
    } finally {
      setExtracting(false);
    }
  }

  async function saveDraft(key: string): Promise<void> {
    const current = drafts.find((item) => item.form.key === key);
    if (!current) return;
    if (!current.form.stem.trim()) {
      patchDraft(key, { error: '题干不能为空，请先填写题目内容' });
      return;
    }
    if (!current.form.answer.trim()) {
      patchDraft(key, { error: '答案不能为空：不会做可以先点「AI 整理」，或先写「待解」' });
      return;
    }
    patchDraft(key, { saving: true, error: undefined });
    try {
      const payload = formToPayload(current.form);
      payload.source = current.form.imagePath ? '拍照识别' : current.form.id ? '手动编辑' : '手动录入';
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
      // 保存成功就把这张卡片收起来，不再显示编辑框
      setDrafts((prev) => prev.filter((item) => item.form.key !== key));
      setSavedNotice(`已保存到错题本：#${saved.id}（${saved.subject || '未标学科'}）${saved.stem.slice(0, 24)}…`);
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError && err.code === 'VALIDATION_FAILED' ? err.message : toErrorState(err).message;
      patchDraft(key, { saving: false, error: message });
    }
  }

  async function saveAll(): Promise<void> {
    const keys = drafts.filter((item) => !item.saving).map((item) => item.form.key);
    for (const key of keys) {
      await saveDraft(key);
    }
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

  const pendingCount = drafts.filter((item) => !item.saving).length;

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
      )}      {textReady && !visionReady && (
        <div className="alert alert--warn">
          文本模型已就绪，但还没有视觉模型：拍照识别会失败。请在 <code>visionModel</code> 里填一个能看图的模型（如
          qwen-vl-max），或直接手打文字让 AI 整理。
        </div>
      )}

      <section className="card">
        <h2>
          <span className="step">1</span> 拍照 / 上传题目
        </h2>
        <p className="muted">手机点“拍照”直接调用摄像头；电脑上“选图片”从文件里挑截图或照片。</p>
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
        {extracting && <p className="loading">AI 正在识别题目、补全答案和知识点…</p>}
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
              setDrafts((prev) => [...prev, { form: { ...emptyForm(), imagePath: imagePath ?? null } }])
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
            {pendingCount > 1 && (
              <button type="button" className="btn" onClick={() => void saveAll()} disabled={extracting}>
                全部保存（{pendingCount}）
              </button>
            )}
          </div>
          {drafts.map((draft, index) => (
            <ProblemCard
              key={draft.form.key}
              form={draft.form}
              title={`识别结果 ${index + 1}`}
              saving={draft.saving}
              error={draft.error}
              onChange={(patch) => patchForm(draft.form.key, patch)}
              onSave={() => void saveDraft(draft.form.key)}
              onDiscard={() => setDrafts((prev) => prev.filter((item) => item.form.key !== draft.form.key))}
            />
          ))}
        </section>
      )}
    </div>
  );
}
