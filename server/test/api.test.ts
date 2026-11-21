import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../app.ts';
import { openDb, ProblemRepo, weekBoundaries } from '../db.ts';
import { distDir, imagesDir } from '../paths.ts';

type Server = {
  url: string;
  close: () => Promise<void>;
};

async function listen(handler: http.RequestListener): Promise<Server> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** 假的 OpenAI 兼容服务：通过 state.mode 控制返回值 */
type FakeState = {
  mode: 'ok' | 'multi' | 'many' | 'badjson' | 'nojsonformat' | 'http500' | 'missingSession';
  calls: number;
  lastBody: Record<string, unknown> | null;
  lastHeaders: Record<string, string | string[] | undefined>;
};

const fake: FakeState = { mode: 'ok', calls: 0, lastBody: null, lastHeaders: {} };

function startFakeAi(): Promise<Server> {
  return listen((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      fake.calls += 1;
      fake.lastHeaders = req.headers;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      fake.lastBody = body;
      if (fake.mode === 'missingSession') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'MissingSessionID',
              message: 'Request is missing x-opencode-session and cannot be routed efficiently.',
            },
          }),
        );
        return;
      }
      if (fake.mode === 'nojsonformat') {
        if (body.response_format) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'response_format is not supported' } }));
          return;
        }
      }
      if (fake.mode === 'http500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'boom' }));
        return;
      }
      const content =
        fake.mode === 'badjson'
          ? '抱歉，我看不清这张图。'
          : JSON.stringify({
              items:
                fake.mode === 'many'
                  ? Array.from({ length: 55 }, (_, index) => ({
                      subject: '数学',
                      grade: '四年级',
                      stem: `${index + 1}. ${index + 100} + ${index} = ?`,
                      options: [],
                      answer: String(index + 100 + index),
                      analysis: '按位相加。',
                      knowledgePoints: ['加法'],
                    }))
                  : fake.mode === 'multi'
                  ? [
                      {
                        subject: '数学',
                        grade: '三年级',
                        stem: '1. 计算：12 + 7 = ?',
                        options: [],
                        answer: '19',
                        analysis: '个位相加。',
                        knowledgePoints: ['两位数加法'],
                        bbox: [40, 100, 960, 250],
                      },
                      {
                        subject: '数学',
                        grade: '三年级',
                        stem: '2. 计算：30 - 8 = ?',
                        options: [],
                        answer: '22',
                        analysis: '退位减法。',
                        knowledgePoints: ['退位减法'],
                        bbox: [40, 300, 960, 470],
                      },
                      {
                        subject: '数学',
                        grade: '三年级',
                        stem: '3. 计算：6 × 4 = ?',
                        options: [],
                        answer: '24',
                        analysis: '乘法口诀。',
                        knowledgePoints: ['表内乘法'],
                        bbox: [40, 520, 960, 690],
                      },
                    ]
                  : [
                      {
                        subject: '数学',
                        grade: '三年级',
                        stem: '小明有 5 个苹果，吃了 2 个，还剩几个？',
                        options: [
                          { key: 'A', text: '2' },
                          { key: 'B', text: '3' },
                        ],
                        answer: 'B',
                        analysis: '5 - 2 = 3。',
                        knowledgePoints: ['10 以内减法'],
                      },
                    ],
            });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
}

let ai: Server;
let tmpRoot: string;
let app: Server;
let repo: ProblemRepo;

function writeConfig(values: Record<string, unknown>): void {
  const file = path.join(tmpRoot, 'config.json');
  fs.writeFileSync(file, JSON.stringify(values, null, 2), 'utf8');
}

async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ status: number; body: T }> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(`${app.url}${url}`, {
    ...rest,
    headers: json === undefined ? rest.headers : { 'Content-Type': 'application/json' },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

function tinyJpegDataUrl(): string {
  // 1x1 红色 JPEG
  const base64 =
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  return `data:image/jpeg;base64,${base64}`;
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'errnote-'));
  process.env.ERRNOTE_DATA = tmpRoot;
  ai = await startFakeAi();
  writeConfig({
    baseURL: `${ai.url}/v1`,
    apiKey: 'test-key',
    model: 'fake-text-model',
    visionModel: 'fake-vision-model',
    headers: { 'x-opencode-session': 'errnote-test' },
    temperature: 0.1,
    timeoutMs: 5000,
    jsonMode: true,
  });
  const db = openDb(path.join(tmpRoot, 'errnote.db'));
  repo = new ProblemRepo(db);
  app = await listen(createApp({ repo }));
  // 让 /images 路由有目录
  fs.mkdirSync(imagesDir(), { recursive: true });
});

after(async () => {
  await app.close();
  await ai.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.ERRNOTE_DATA;
});

describe('基础接口', () => {
  it('health 返回配置状态但不泄露 key', async () => {
    const { status, body } = await call<{
      ok: boolean;
      ai: { text: { ready: boolean; model: string }; vision: { ready: boolean } };
    }>('/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.ai.text.ready, true);
    assert.equal(body.ai.vision.ready, true);
    assert.ok(!JSON.stringify(body).includes('test-key'));
  });

  it('题干为空时返回 400', async () => {
    const { status, body } = await call<{ error: { code: string } }>('/api/problems', {
      method: 'POST',
      json: { subject: '数学', stem: '   ' },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_FAILED');
  });

  it('答案为空时返回 400 并提示补答案', async () => {
    const { status, body } = await call<{ error: { code: string; message: string } }>('/api/problems', {
      method: 'POST',
      json: { subject: '数学', stem: '1+1=?', answer: '   ' },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_FAILED');
    assert.match(body.error.message, /答案不能为空/);
  });

  it('非法 JSON 返回 400', async () => {
    const response = await fetch(`${app.url}/api/problems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops',
    });
    assert.equal(response.status, 400);
  });

  it('不存在的接口返回 404 JSON', async () => {
    const { status, body } = await call<{ error: { code: string } }>('/api/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});

describe('题库存取与筛选', () => {
  it('插入 100 条后各维度筛选结果正确', async () => {
    const subjects = ['数学', '语文', '英语'];
    for (let i = 0; i < 100; i += 1) {
      const subject = subjects[i % 3];
      const payload: Record<string, unknown> = {
        subject,
        grade: i % 2 === 0 ? '三年级' : '四年级',
        stem: `第 ${i} 题：计算 ${i} + ${i} 的结果`,
        answer: String(i * 2),
        analysis: `答案是 ${i * 2}`,
        knowledgePoints: i % 5 === 0 ? ['加法交换律'] : ['加法'],
        mastered: false,
      };
      if (i < 3) {
        const upload = await call<{ path: string }>('/api/images', { method: 'POST', json: { dataUrl: tinyJpegDataUrl() } });
        payload.imagePath = upload.body.path;
      }
      const created = await call<{ item: { id: number } }>('/api/problems', { method: 'POST', json: payload });
      assert.equal(created.status, 201);
    }

    const all = await call<{ total: number; items: unknown[] }>('/api/problems?limit=5');
    assert.equal(all.body.total, 100);
    assert.equal(all.body.items.length, 5);

    const math = await call<{ total: number }>('/api/problems?subject=数学&limit=1');
    assert.ok(math.body.total >= 33);

    const grade3 = await call<{ total: number }>(
      `/api/problems?grade=${encodeURIComponent('三年级')}&limit=1`,
    );
    assert.equal(grade3.body.total, 50);

    const point = await call<{ total: number }>(
      `/api/problems?knowledgePoint=${encodeURIComponent('加法交换律')}&limit=1`,
    );
    assert.equal(point.body.total, 20);

    const search = await call<{ total: number }>(`/api/problems?q=${encodeURIComponent('第 42 题')}`);
    assert.equal(search.body.total, 1);
  });

  it('错误次数 +1 会记录时间，已掌握可切换', async () => {
    const created = await call<{ item: { id: number; wrongCount: number; wrongTimes: string[] } }>('/api/problems', {
      method: 'POST',
      json: { subject: '数学', stem: '状态测试题', answer: '1' },
    });
    const id = created.body.item.id;
    // 新录入的题错误次数从 0 开始，录入时间不算错误时间
    assert.equal(created.body.item.wrongCount, 0);
    assert.equal(created.body.item.wrongTimes.length, 0);

    const wrong = await call<{ item: { wrongCount: number; wrongTimes: string[] } }>(`/api/problems/${id}/wrong`, {
      method: 'POST',
    });
    assert.equal(wrong.body.item.wrongCount, 1);
    assert.equal(wrong.body.item.wrongTimes.length, 1);
    assert.ok(wrong.body.item.wrongTimes.every((time) => !Number.isNaN(Date.parse(time))));

    const mastered = await call<{ item: { mastered: boolean } }>(`/api/problems/${id}/mastered`, {
      method: 'POST',
      json: { mastered: true },
    });
    assert.equal(mastered.body.item.mastered, true);
    const list = await call<{ total: number }>('/api/problems?mastered=1');
    assert.equal(list.body.total, 1);
  });

  it('错误次数过滤：默认 1 次以上，可筛 2 次以上', async () => {
    const created = await call<{ item: { id: number } }>('/api/problems', {
      method: 'POST',
      json: { subject: '次数测试', stem: '只错过一次的题', answer: '1' },
    });
    const id = created.body.item.id;

    const zero = await call<{ total: number }>('/api/problems?subject=次数测试&minWrongCount=1');
    assert.equal(zero.body.total, 0);
    const twice = await call<{ total: number }>('/api/problems?subject=次数测试&minWrongCount=2');
    assert.equal(twice.body.total, 0);

    await call(`/api/problems/${id}/wrong`, { method: 'POST' });
    const once = await call<{ total: number }>('/api/problems?subject=次数测试&minWrongCount=1');
    assert.equal(once.body.total, 1);
    const twiceAfter = await call<{ total: number }>('/api/problems?subject=次数测试&minWrongCount=2');
    assert.equal(twiceAfter.body.total, 0);

    await call(`/api/problems/${id}/wrong`, { method: 'POST' });
    const twiceAfterTwo = await call<{ total: number }>('/api/problems?subject=次数测试&minWrongCount=2');
    assert.equal(twiceAfterTwo.body.total, 1);
  });

  it('新录入的题不会因为录入时间而命中时间筛选', async () => {
    const created = await call<{ item: { id: number } }>('/api/problems', {
      method: 'POST',
      json: { subject: '录入时间测试', stem: '刚录入还没再错的题', answer: '1' },
    });
    const recent = await call<{ total: number }>(
      `/api/problems?subject=${encodeURIComponent('录入时间测试')}&after=${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}`,
    );
    assert.equal(recent.body.total, 0, '录入时间不算错误时间');

    await call(`/api/problems/${created.body.item.id}/wrong`, { method: 'POST' });
    const afterWrong = await call<{ total: number }>(
      `/api/problems?subject=${encodeURIComponent('录入时间测试')}&after=${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}`,
    );
    assert.equal(afterWrong.body.total, 1);
  });

  it('按年级筛选，并返回年级统计', async () => {
    const endpoint = await call<{ grades: { grade: string; n: number }[] }>('/api/grades');
    assert.equal(endpoint.status, 200);
    assert.ok(endpoint.body.grades.some((item) => item.grade === '三年级'));

    const list = await call<{ total: number; grades: { grade: string }[] }>(
      `/api/problems?grade=${encodeURIComponent('三年级')}&limit=1`,
    );
    assert.ok(list.body.total > 0);
    assert.ok(Array.isArray(list.body.grades));

    const none = await call<{ total: number }>(`/api/problems?grade=${encodeURIComponent('不存在的年级')}`);
    assert.equal(none.body.total, 0);
  });

  it('按发生日期区间筛选错题（任意一次错误时间命中即可）', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const old = repo.importDraft({
      subject: '日期测试',
      grade: '三年级',
      stem: '十天前的错题',
      options: [],
      answer: '1',
      analysis: '',
      knowledgePoints: ['日期测试'],
      source: 'test',
      imagePath: null,
      createdAt: tenDaysAgo,
      wrongCount: 1,
      wrongTimes: [tenDaysAgo],
    });
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const before = await call<{ total: number; items: { id: number }[] }>(
      `/api/problems?before=${encodeURIComponent(fiveDaysAgo)}&subject=${encodeURIComponent('日期测试')}`,
    );
    assert.equal(before.body.total, 1);
    assert.equal(before.body.items[0].id, old.id);

    const recent = await call<{ total: number }>(
      `/api/problems?after=${encodeURIComponent(fiveDaysAgo)}&subject=${encodeURIComponent('日期测试')}`,
    );
    assert.equal(recent.body.total, 0);

    // 十天前的题今天又错了一次 → 最近 5 天筛选也应该命中
    await call(`/api/problems/${old.id}/wrong`, { method: 'POST' });
    const recentAfter = await call<{ total: number }>(
      `/api/problems?after=${encodeURIComponent(fiveDaysAgo)}&subject=${encodeURIComponent('日期测试')}`,
    );
    assert.equal(recentAfter.body.total, 1);
  });

  it('练习页周视图：本周新录入（0 次） + 上周最后一次错误', async () => {
    const { thisMonday, lastMonday } = weekBoundaries();
    const thisMs = Date.parse(thisMonday);
    const lastMs = Date.parse(lastMonday);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    const at = (ms: number) => new Date(ms).toISOString();
    const subject = '周视图测试';

    repo.importDraft({
      subject,
      stem: '本周新录入',
      answer: '1',
      createdAt: at(thisMs + 2 * hour),
    });
    repo.importDraft({
      subject,
      stem: '本周新录入但已经错过',
      answer: '1',
      createdAt: at(thisMs + 2 * hour),
      wrongCount: 1,
      wrongTimes: [at(thisMs + 3 * hour)],
    });
    repo.importDraft({
      subject,
      stem: '上周最后一次错',
      answer: '1',
      createdAt: at(lastMs - 14 * day),
      wrongCount: 2,
      wrongTimes: [at(lastMs - 13 * day), at(lastMs + 2 * day)],
    });
    repo.importDraft({
      subject,
      stem: '上周错过、本周又错',
      answer: '1',
      createdAt: at(lastMs - 14 * day),
      wrongCount: 2,
      wrongTimes: [at(lastMs + 2 * day), at(thisMs + hour)],
    });
    repo.importDraft({
      subject,
      stem: '只有更早的错',
      answer: '1',
      createdAt: at(lastMs - 14 * day),
      wrongCount: 1,
      wrongTimes: [at(lastMs - 3 * day)],
    });
    repo.importDraft({
      subject,
      stem: '上周录入还没错',
      answer: '1',
      createdAt: at(lastMs + 2 * hour),
    });

    const weekly = repo.list({ weekly: true, subject });
    assert.equal(weekly.total, 2);
    assert.deepEqual(weekly.items.map((item) => item.stem).sort(), ['上周最后一次错', '本周新录入']);

    const viaApi = await call<{ total: number }>(
      `/api/problems?scope=weekly&mastered=0&subject=${encodeURIComponent(subject)}`,
    );
    assert.equal(viaApi.body.total, 2);
  });

  it('老库（v1）升级后自动补错误时间并计入首次错误', () => {    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'errnote-migrate-'));
    const file = path.join(dir, 'old.db');
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL DEFAULT '',
        grade TEXT NOT NULL DEFAULT '',
        stem TEXT NOT NULL,
        options TEXT NOT NULL DEFAULT '[]',
        answer TEXT NOT NULL DEFAULT '',
        analysis TEXT NOT NULL DEFAULT '',
        knowledge_points TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT '',
        image_path TEXT,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        mastered INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    const oldTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    raw
      .prepare(
        `INSERT INTO problems (subject, grade, stem, answer, wrong_count, created_at, updated_at)
         VALUES ('数学', '三年级', '老库里的题', '1', 0, ?, ?)`,
      )
      .run(oldTime, oldTime);
    raw.close();

    const db = openDb(file);
    const migrated = new ProblemRepo(db);
    const item = migrated.get(1);
    assert.equal(item?.wrongCount, 1, '首次错误应计入次数');
    assert.equal(item?.wrongTimes.length, 1);
    assert.equal(item?.wrongTimes[0], oldTime);
    assert.equal(item?.unit, '', '新列默认空字符串');
    assert.equal(item?.semester, '');
    assert.equal(item?.problemType, '');
    const recent = migrated.list({
      createdAfter: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(recent.total, 0, '20 天前的题不该出现在最近 5 天里');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('单元/学期/题型/已掌握可以写入与修改', async () => {
    const created = await call<{
      item: { id: number; unit: string; semester: string; problemType: string; mastered: boolean };
    }>('/api/problems', {
      method: 'POST',
      json: {
        subject: '数学',
        grade: '三年级',
        unit: '第三单元',
        semester: '上学期',
        problemType: '选择题',
        stem: '属性测试题',
        answer: 'A',
        mastered: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.unit, '第三单元');
    assert.equal(created.body.item.semester, '上学期');
    assert.equal(created.body.item.problemType, '选择题');
    assert.equal(created.body.item.mastered, true);

    const updated = await call<{ item: { mastered: boolean; unit: string } }>(
      `/api/problems/${created.body.item.id}`,
      { method: 'PUT', json: { mastered: false, unit: '第四单元' } },
    );
    assert.equal(updated.body.item.mastered, false);
    assert.equal(updated.body.item.unit, '第四单元');

    const active = await call<{ total: number }>(
      `/api/problems?subject=${encodeURIComponent('数学')}&q=${encodeURIComponent('属性测试题')}&mastered=0`,
    );
    assert.equal(active.body.total, 1);

    const byUnit = await call<{ total: number }>(`/api/problems?unit=${encodeURIComponent('第四单元')}`);
    assert.equal(byUnit.body.total, 1);
    const bySemester = await call<{ total: number }>(`/api/problems?semester=${encodeURIComponent('上学期')}`);
    assert.ok(bySemester.body.total >= 1);
    const noUnit = await call<{ total: number }>(`/api/problems?unit=${encodeURIComponent('第九单元')}`);
    assert.equal(noUnit.body.total, 0);

    const filters = await call<{ units: { unit: string }[]; semesters: { semester: string }[] }>('/api/filters');
    assert.equal(filters.status, 200);
    assert.ok(filters.body.units.some((item) => item.unit === '第四单元'));
    assert.ok(filters.body.semesters.some((item) => item.semester === '上学期'));
  });

  it('重开数据库后题目与图片条数不变', async () => {    const before = repo.count();
    const beforeImages = repo.countImages();
    const files = fs.readdirSync(imagesDir()).length;
    const db2 = openDb(path.join(tmpRoot, 'errnote.db'));
    const repo2 = new ProblemRepo(db2);
    assert.equal(repo2.count(), before);
    assert.equal(repo2.countImages(), beforeImages);
    assert.equal(fs.readdirSync(imagesDir()).length, files);
    db2.close();
  });
});

describe('图片与备份', () => {
  it('上传图片后可访问，列表带 imagePath', async () => {
    const upload = await call<{ path: string }>('/api/images', { method: 'POST', json: { dataUrl: tinyJpegDataUrl() } });
    assert.equal(upload.status, 201);
    assert.match(upload.body.path, /^\/images\/[\w.-]+\.jpg$/);
    const image = await fetch(`${app.url}${upload.body.path}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    const saved = fs.readFileSync(path.join(imagesDir(), path.basename(upload.body.path)));
    assert.ok(saved.length > 0);
  });

  it('拒绝非图片 data URL', async () => {
    const { status, body } = await call<{ error: { code: string } }>('/api/images', {
      method: 'POST',
      json: { dataUrl: 'data:text/plain;base64,aGVsbG8=' },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'IMAGE_INVALID');
  });

  it('导出 zip 后导入到空库，题目与图片数量一致', async () => {
    const response = await fetch(`${app.url}/api/export`);
    assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(buffer.length > 100);
    const imageCount = fs.readdirSync(imagesDir()).length;
    const total = repo.count();

    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'errnote-restore-'));
    const previousData = process.env.ERRNOTE_DATA;
    process.env.ERRNOTE_DATA = secondRoot;
    const db2 = openDb(path.join(secondRoot, 'errnote.db'));
    const app2 = await listen(createApp({ repo: new ProblemRepo(db2) }));
    try {
      const response2 = await fetch(`${app2.url}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: buffer,
      });
      assert.equal(response2.status, 200);
      const result = (await response2.json()) as { problems: number; images: number };
      assert.equal(result.problems, total);
      assert.equal(result.images, imageCount);
      const list = await fetch(`${app2.url}/api/problems?limit=1`);
      const listed = (await list.json()) as { total: number };
      assert.equal(listed.total, total);
      assert.equal(fs.readdirSync(path.join(secondRoot, 'images')).length, imageCount);
    } finally {
      await app2.close();
      db2.close();
      process.env.ERRNOTE_DATA = previousData;
      fs.rmSync(secondRoot, { recursive: true, force: true });
    }
  });
});

describe('AI 识别（OpenAI 兼容）', () => {
  it('未配置 key 时返回 400 且带 code', async () => {
    writeConfig({ baseURL: `${ai.url}/v1`, apiKey: '', model: 'fake-text-model' });
    const { status, body } = await call<{ error: { code: string } }>('/api/ai/extract', {
      method: 'POST',
      json: { text: '1+1=?' },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'AI_NOT_CONFIGURED');
  });

  it('文字整理返回结构化题目并可入库检索', async () => {
    writeConfig({
      baseURL: `${ai.url}/v1`,
      apiKey: 'test-key',
      model: 'fake-text-model',
      visionModel: 'fake-vision-model',
      jsonMode: true,
    });
    fake.mode = 'ok';
    const { status, body } = await call<{ items: { stem: string; answer: string; knowledgePoints: string[] }[] }>(
      '/api/ai/extract',
      { method: 'POST', json: { text: '小明有5个苹果，吃了2个，还剩几个？' } },
    );
    assert.equal(status, 200);
    assert.equal(body.items.length, 1);
    assert.ok(body.items[0].stem.length > 0);
    assert.ok(body.items[0].answer.length > 0);
    assert.ok(body.items[0].knowledgePoints.includes('10 以内减法'));

    const saved = await call<{ item: { id: number } }>('/api/problems', {
      method: 'POST',
      json: body.items[0],
    });
    assert.equal(saved.status, 201);
    const found = await call<{ total: number }>(
      `/api/problems?knowledgePoint=${encodeURIComponent('10 以内减法')}`,
    );
    assert.ok(found.body.total >= 1);
  });

  it('图片识别走视觉模型并带上图片', async () => {
    fake.mode = 'ok';
    fake.lastBody = null;
    const upload = await call<{ path: string }>('/api/images', { method: 'POST', json: { dataUrl: tinyJpegDataUrl() } });
    const { status, body } = await call<{ items: unknown[]; model: string; imagePath: string }>('/api/ai/extract', {
      method: 'POST',
      json: { imagePath: upload.body.path },
    });
    assert.equal(status, 200);
    assert.equal(body.model, 'fake-vision-model');
    assert.equal(body.imagePath, upload.body.path);
    const lastBody = fake.lastBody as Record<string, unknown> | null;
    const messages = (lastBody?.messages ?? []) as {
      role: string;
      content: { type: string; image_url?: { url: string } }[] | string;
    }[];
    const user = messages.find((message) => message.role === 'user');
    assert.ok(Array.isArray(user?.content));
    const parts = user.content as { type: string; image_url?: { url: string } }[];
    assert.ok(parts.some((part) => part.type === 'image_url' && part.image_url?.url.startsWith('data:image/jpeg;base64,')));
  });

  it('一张图多道题时逐题返回，并把 bbox 统一成 0~1 比例', async () => {
    fake.mode = 'multi';
    const upload = await call<{ path: string }>('/api/images', { method: 'POST', json: { dataUrl: tinyJpegDataUrl() } });
    const { status, body } = await call<{
      items: { stem: string; answer: string; bbox: [number, number, number, number] | null }[];
    }>('/api/ai/extract', { method: 'POST', json: { imagePath: upload.body.path } });
    assert.equal(status, 200);
    assert.equal(body.items.length, 3);
    assert.match(body.items[0].stem, /12 \+ 7/);
    assert.match(body.items[2].stem, /6 × 4/);
    // 模型给的是 0~1000 量纲，接口返回时要缩到 0~1
    assert.deepEqual(body.items[0].bbox, [0.04, 0.1, 0.96, 0.25]);
    assert.deepEqual(body.items[2].bbox, [0.04, 0.52, 0.96, 0.69]);
  });

  it('题目很多时按上限截断到 50 道', async () => {
    fake.mode = 'many';
    const upload = await call<{ path: string }>('/api/images', { method: 'POST', json: { dataUrl: tinyJpegDataUrl() } });
    const { status, body } = await call<{ items: { stem: string }[] }>('/api/ai/extract', {
      method: 'POST',
      json: { imagePath: upload.body.path },
    });
    assert.equal(status, 200);
    assert.equal(body.items.length, 50);
    assert.match(body.items[0].stem, /^1\. 100/);
    assert.match(body.items[49].stem, /^50\. 149/);
  });

  it('服务商不支持 response_format 时自动降级重试', async () => {    fake.mode = 'nojsonformat';
    fake.calls = 0;
    const { status, body } = await call<{ items: unknown[] }>('/api/ai/extract', {
      method: 'POST',
      json: { text: '5+5=?' },
    });
    assert.equal(status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(fake.calls, 2);
  });

  it('模型两次都返回非 JSON 时给出 502 结构化错误', async () => {
    fake.mode = 'badjson';
    const { status, body } = await call<{ error: { code: string; message: string } }>('/api/ai/extract', {
      method: 'POST',
      json: { text: '5+5=?' },
    });
    assert.equal(status, 502);
    assert.ok(['AI_BAD_JSON', 'AI_NO_RESULT'].includes(body.error.code));
    assert.ok(body.error.message.length > 0);
  });

  it('上游 500 时返回 502 AI_UPSTREAM', async () => {
    fake.mode = 'http500';
    const { status, body } = await call<{ error: { code: string } }>('/api/ai/extract', {
      method: 'POST',
      json: { text: '5+5=?' },
    });
    assert.equal(status, 502);
    assert.equal(body.error.code, 'AI_UPSTREAM');
  });
});

describe('AI 请求头与连接诊断', () => {
  function useFakeAi(): void {
    writeConfig({
      baseURL: `${ai.url}/v1`,
      apiKey: 'test-key',
      model: 'fake-text-model',
      visionModel: 'fake-vision-model',
      headers: { 'x-opencode-session': 'errnote-test' },
      temperature: 0.1,
      timeoutMs: 5000,
      jsonMode: true,
    });
  }

  it('自定义 headers 会透传给上游', async () => {
    useFakeAi();
    fake.mode = 'ok';
    const { status } = await call('/api/ai/extract', { method: 'POST', json: { text: '1+1=?' } });
    assert.equal(status, 200);
    assert.equal(fake.lastHeaders['x-opencode-session'], 'errnote-test');
  });

  it('网关缺 session 头时带出上游原因和修复提示', async () => {
    useFakeAi();
    fake.mode = 'missingSession';
    const { status, body } = await call<{
      error: { code: string; message: string; hint: string; detail: string };
    }>('/api/ai/extract', { method: 'POST', json: { text: '1+1=?' } });
    assert.equal(status, 502);
    assert.equal(body.error.code, 'AI_UPSTREAM');
    assert.match(body.error.message, /x-opencode-session/);
    assert.match(body.error.hint, /headers/);
    assert.ok(body.error.detail.length > 0);
  });

  it('测试连接：文本与识图都能返回结果', async () => {
    useFakeAi();
    fake.mode = 'ok';
    const text = await call<{ ok: boolean; model: string; latencyMs: number; sample: string }>('/api/ai/test', {
      method: 'POST',
      json: { mode: 'text' },
    });
    assert.equal(text.status, 200);
    assert.equal(text.body.ok, true);
    assert.equal(text.body.model, 'fake-text-model');
    assert.ok(text.body.sample.length > 0);

    const vision = await call<{ ok: boolean; model: string }>('/api/ai/test', {
      method: 'POST',
      json: { mode: 'vision' },
    });
    assert.equal(vision.status, 200);
    assert.equal(vision.body.model, 'fake-vision-model');

    const lastBody = fake.lastBody as Record<string, unknown> | null;
    const messages = (lastBody?.messages ?? []) as { content: unknown }[];
    const parts = messages[0]?.content as { type: string }[];
    assert.ok(Array.isArray(parts) && parts.some((part) => part.type === 'image_url'));
  });

  it('未配置 key 时测试连接返回 400', async () => {
    writeConfig({ baseURL: `${ai.url}/v1`, apiKey: '', model: 'fake-text-model' });
    const { status, body } = await call<{ error: { code: string } }>('/api/ai/test', {
      method: 'POST',
      json: { mode: 'text' },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'AI_NOT_CONFIGURED');
    useFakeAi();
  });
});

describe('错题练习与提示词', () => {
  function useFakeAi(): void {
    writeConfig({
      baseURL: `${ai.url}/v1`,
      apiKey: 'test-key',
      model: 'fake-text-model',
      visionModel: 'fake-vision-model',
      headers: { 'x-opencode-session': 'errnote-test' },
      temperature: 0.1,
      timeoutMs: 5000,
      jsonMode: true,
    });
  }

  it('GET /api/subjects 返回学科统计', async () => {
    const { status, body } = await call<{ subjects: { subject: string; n: number }[] }>('/api/subjects');
    assert.equal(status, 200);
    assert.ok(body.subjects.some((item) => item.subject === '数学'));
  });

  it('GET /api/prompts 返回三档难度与各学科提示词', async () => {
    const { status, body } = await call<{
      difficulties: { key: string; label: string }[];
      prompts: Record<string, Record<string, string>>;
      defaults: Record<string, Record<string, string>>;
    }>('/api/prompts');
    assert.equal(status, 200);
    assert.deepEqual(
      body.difficulties.map((item) => item.key),
      ['easy', 'medium', 'hard'],
    );
    assert.equal(body.difficulties[0].label, '容易');
    assert.ok(body.prompts['数学'].easy.includes('数字'));
    assert.ok(body.prompts['通用'].hard.length > 0);
    assert.ok(body.defaults['英语'].medium.includes('否定'));
  });

  it('按难度生成新题，提示词模板会进入请求', async () => {
    useFakeAi();
    fake.mode = 'ok';
    const created = await call<{ item: { id: number } }>('/api/problems', {
      method: 'POST',
      json: { subject: '数学', grade: '三年级', stem: '5 + 3 = ?', answer: '8', knowledgePoints: ['加法'] },
    });
    const id = created.body.item.id;

    const result = await call<{ items: { stem: string; answer: string }[]; difficulty: string; prompt: string }>(
      '/api/practice/generate',
      { method: 'POST', json: { problemId: id, difficulty: 'hard' } },
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.difficulty, 'hard');
    assert.ok(result.body.items[0].stem.length > 0);
    assert.ok(result.body.prompt.includes('重新设计'), '难档模板应被使用');

    const lastBody = fake.lastBody as Record<string, unknown> | null;
    const messages = (lastBody?.messages ?? []) as { role: string; content: string }[];
    const userContent = messages.find((message) => message.role === 'user');
    assert.ok(userContent?.content.includes('重新设计一道新题'));
    assert.ok(userContent?.content.includes('5 + 3 = ?'));
    assert.ok(userContent?.content.includes('难度：难'));
  });

  it('难度非法时返回 400，题目不存在返回 404', async () => {
    const badLevel = await call<{ error: { code: string } }>('/api/practice/generate', {
      method: 'POST',
      json: { problemId: 1, difficulty: 'impossible' },
    });
    assert.equal(badLevel.status, 400);
    assert.equal(badLevel.body.error.code, 'BAD_DIFFICULTY');

    const missing = await call<{ error: { code: string } }>('/api/practice/generate', {
      method: 'POST',
      json: { problemId: 999999, difficulty: 'easy' },
    });
    assert.equal(missing.status, 404);
  });

  it('保存自定义提示词后，下一次生成使用新模板', async () => {
    useFakeAi();
    const save = await call<{ ok: boolean }>('/api/prompts', {
      method: 'PUT',
      json: { prompts: { 数学: { easy: '自定义容易模板：只换数字', medium: '', hard: '' } } },
    });
    assert.equal(save.status, 200);

    const after = await call<{ prompts: Record<string, Record<string, string>> }>('/api/prompts');
    assert.equal(after.body.prompts['数学'].easy, '自定义容易模板：只换数字');
    assert.ok(after.body.prompts['数学'].hard.includes('重新设计'), '未覆盖的难度仍用默认');

    const list = await call<{ items: { id: number }[] }>('/api/problems?subject=数学&limit=1');
    const id = list.body.items[0].id;
    const result = await call<{ prompt: string }>('/api/practice/generate', {
      method: 'POST',
      json: { problemId: id, difficulty: 'easy' },
    });
    assert.equal(result.body.prompt, '自定义容易模板：只换数字');

    // 还原，避免影响其他用例
    await call('/api/prompts', { method: 'PUT', json: { prompts: {} } });
    const restored = await call<{ prompts: Record<string, Record<string, string>> }>('/api/prompts');
    assert.ok(restored.body.prompts['数学'].easy.includes('数字'));
  });
});

describe('前端产物', () => {
  it('构建产物里没有 API key', { skip: !fs.existsSync(distDir()) }, () => {
    const walk = (dir: string): string[] => {
      const files: string[] = [];
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isDirectory()) files.push(...walk(file));
        else files.push(file);
      }
      return files;
    };
    for (const file of walk(distDir())) {
      const content = fs.readFileSync(file, 'utf8');
      assert.ok(!content.includes('test-key'), `${file} 里出现了 key`);
    }
  });
});
