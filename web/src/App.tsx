import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { AddProblem } from './pages/AddProblem';
import { Library } from './pages/Library';
import { Practice } from './pages/Practice';
import { Settings } from './pages/Settings';
import type { Health } from './types';

type Tab = 'practice' | 'library' | 'add';
type View = Tab | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'practice', label: '错题练习' },
  { key: 'library', label: '错题本' },
  { key: 'add', label: '加题目' },
];

export default function App() {
  const [view, setView] = useState<View>('practice');
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState('');
  const [notice, setNotice] = useState('');
  const importInput = useRef<HTMLInputElement>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const result = await api<Health>('/api/health');
      setHealth(result);
      setHealthError('');
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : '服务未连接');
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  async function importBackup(file: File | undefined): Promise<void> {
    if (!file) return;
    setNotice('正在导入备份…');
    try {
      const buffer = await file.arrayBuffer();
      const result = await api<{ problems: number; images: number }>('/api/import', {
        method: 'POST',
        raw: buffer,
        timeoutMs: 600000,
      });
      setNotice(`导入完成：${result.problems} 道题、${result.images} 张图片`);
      await refreshHealth();
    } catch (error) {
      setNotice(error instanceof Error ? `导入失败：${error.message}` : '导入失败');
    }
  }

  async function openDataDir(): Promise<void> {
    try {
      const result = await api<{ dir: string }>('/api/open-data-dir', { method: 'POST' });
      setNotice(`已打开数据目录：${result.dir}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打不开目录');
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>错题本</h1>
          <span className="muted small">{health ? `${health.problems} 道题目` : '连接中…'}</span>
        </div>
        <nav className="tabs">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`tab${view === item.key ? ' is-active' : ''}`}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="tools">
          <button
            type="button"
            className={`btn btn--sm${view === 'settings' ? ' btn--primary' : ''}`}
            onClick={() => setView(view === 'settings' ? 'practice' : 'settings')}
          >
            设置
          </button>
          <a className="btn btn--sm" href="/api/export">
            备份
          </a>
          <button type="button" className="btn btn--sm" onClick={() => importInput.current?.click()}>
            导入
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              void importBackup(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void openDataDir()}>
            数据目录
          </button>
        </div>
      </header>

      {healthError && <div className="alert alert--error">服务未连接：{healthError}</div>}
      {notice && (
        <div className="alert alert--info" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}

      <main>
        {view === 'practice' && <Practice healthReady={health?.ai.text.ready ?? true} />}
        {view === 'library' && <Library onChanged={() => void refreshHealth()} />}
        {view === 'add' && <AddProblem health={health} onSaved={() => void refreshHealth()} />}
        {view === 'settings' && <Settings />}
      </main>

      <footer className="app-footer muted small">
        {health ? `数据目录 ${health.dataDir} · 备份＝复制这个文件夹` : ''}
      </footer>
    </div>
  );
}
