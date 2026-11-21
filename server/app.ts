import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AiError, extractProblems, generatePractice, testConnection } from './ai.ts';
import { exportZip, importZip } from './backup.ts';
import { ConfigError, describeConfig, loadConfig } from './config.ts';
import { ProblemRepo } from './db.ts';
import { saveImageDataUrl } from './images.ts';
import { ImageError } from './images.ts';
import { ValidationError } from './model.ts';
import {
  DIFFICULTIES,
  defaultPromptBook,
  effectivePromptBook,
  savePromptOverrides,
  type Difficulty,
} from './prompts.ts';
import { dataDir, distDir } from './paths.ts';

const VERSION = '0.1.0';
const JSON_LIMIT = 30 * 1024 * 1024;
const ZIP_LIMIT = 300 * 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<void>;

export type AppDeps = {
  repo: ProblemRepo;
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, error: unknown): void {
  const known =
    error instanceof HttpError ||
    error instanceof ValidationError ||
    error instanceof AiError ||
    error instanceof ImageError ||
    error instanceof ConfigError;
  const status = known ? (error as { status: number }).status : 500;
  const code = known ? (error as { code: string }).code : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  if (!known) console.error('[server]', error);
  const detail =
    error instanceof AiError || error instanceof HttpError ? (error as { detail?: string }).detail ?? '' : '';
  const hint = error instanceof AiError ? error.hint : '';
  if (error instanceof AiError) {
    console.error(`[ai] ${code} ${message}${hint ? ` | 提示：${hint}` : ''}${detail ? ` | 上游：${detail.slice(0, 300)}` : ''}`);
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, status, { error: { code, message, detail, hint } });
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '上传内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => reject(error));
  });
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, JSON_LIMIT);
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    throw new Error('body is not an object');
  } catch {
    throw new HttpError(400, 'BAD_JSON', '请求体不是合法 JSON');
  }
}

function openDataDir(): void {
  const dir = dataDir();
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [dir], { detached: true, stdio: 'ignore' });
  child.on('error', (error) => console.error('[server] 无法打开数据目录', error));
  child.unref();
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(res: http.ServerResponse, filePath: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const noCache = ext === '.html';
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': noCache ? 'no-store' : 'public, max-age=3600',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

export function createApp(deps: AppDeps): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { repo } = deps;

  const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
    {
      method: 'GET',
      pattern: /^\/api\/health$/,
      handler: async (_req, res) => {
        const config = loadConfig();
        sendJson(res, 200, {
          ok: true,
          version: VERSION,
          dataDir: dataDir(),
          problems: repo.count(),
          images: repo.countImages(),
          ai: describeConfig(config),
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/problems$/,
      handler: async (_req, res, url) => {
        const params = url.searchParams;
        const masteredRaw = params.get('mastered');
        const before = params.get('before');
        const after = params.get('after');
        const result = repo.list({
          limit: Number(params.get('limit') ?? 20),
          offset: Number(params.get('offset') ?? 0),
          subject: params.get('subject') ?? undefined,
          grade: params.get('grade') ?? undefined,
          knowledgePoint: params.get('knowledgePoint') ?? undefined,
          mastered: masteredRaw === '1' || masteredRaw === 'true' ? true : masteredRaw === '0' || masteredRaw === 'false' ? false : undefined,
          q: params.get('q')?.trim() || undefined,
          createdBefore: before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : undefined,
          createdAfter: after && !Number.isNaN(Date.parse(after)) ? new Date(after).toISOString() : undefined,
        });
        sendJson(res, 200, { ...result, subjects: repo.subjects(), grades: repo.grades() });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/subjects$/,
      handler: async (_req, res) => {
        sendJson(res, 200, { subjects: repo.subjects() });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/grades$/,
      handler: async (_req, res) => {
        sendJson(res, 200, { grades: repo.grades() });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/prompts$/,
      handler: async (_req, res) => {
        sendJson(res, 200, {
          difficulties: DIFFICULTIES,
          prompts: effectivePromptBook(),
          defaults: defaultPromptBook(),
        });
      },
    },
    {
      method: 'PUT',
      pattern: /^\/api\/prompts$/,
      handler: async (req, res) => {
        const body = await readJson(req);
        const saved = savePromptOverrides(body.prompts);
        sendJson(res, 200, { ok: true, saved: Object.keys(saved).length });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/practice\/generate$/,
      handler: async (req, res) => {
        const body = await readJson(req);
        const id = Number(body.problemId);
        const difficulty = body.difficulty;
        if (!DIFFICULTIES.some((item) => item.key === difficulty)) {
          throw new HttpError(400, 'BAD_DIFFICULTY', '难度只能是 easy / medium / hard');
        }
        const problem = repo.get(id);
        if (!problem) throw new HttpError(404, 'NOT_FOUND', '题目不存在');
        const result = await generatePractice(problem, difficulty as Difficulty);
        sendJson(res, 200, result);
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/problems\/(\d+)$/,
      handler: async (_req, res, url) => {
        const id = Number(url.pathname.split('/').pop());
        const item = repo.get(id);
        if (!item) throw new HttpError(404, 'NOT_FOUND', '题目不存在');
        sendJson(res, 200, { item });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/problems$/,
      handler: async (req, res) => {
        const body = await readJson(req);
        const item = repo.create(body);
        sendJson(res, 201, { item });
      },
    },
    {
      method: 'PUT',
      pattern: /^\/api\/problems\/(\d+)$/,
      handler: async (req, res, url) => {
        const id = Number(url.pathname.split('/').pop());
        const body = await readJson(req);
        const item = repo.update(id, body);
        if (!item) throw new HttpError(404, 'NOT_FOUND', '题目不存在');
        sendJson(res, 200, { item });
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/problems\/(\d+)$/,
      handler: async (_req, res, url) => {
        const id = Number(url.pathname.split('/').pop());
        if (!repo.remove(id)) throw new HttpError(404, 'NOT_FOUND', '题目不存在');
        res.writeHead(204);
        res.end();
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/problems\/(\d+)\/wrong$/,
      handler: async (_req, res, url) => {
        const id = Number(url.pathname.split('/')[3]);
        const item = repo.markWrong(id);
        if (!item) throw new HttpError(404, 'NOT_FOUND', '题目不存在');
        sendJson(res, 200, { item });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/problems\/(\d+)\/mastered$/,
      handler: async (req, res, url) => {
        const id = Number(url.pathname.split('/')[3]);
        const body = await readJson(req);
        const item = repo.setMastered(id, Boolean(body.mastered));
        if (!item) throw new HttpError(404, 'NOT_FOUND', '题目不存在');
        sendJson(res, 200, { item });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/images$/,
      handler: async (req, res) => {
        const body = await readJson(req);
        const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
        if (!dataUrl) throw new HttpError(400, 'NO_IMAGE', '缺少图片数据');
        const imagePath = saveImageDataUrl(dataUrl);
        sendJson(res, 201, { path: imagePath });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/ai\/extract$/,
      handler: async (req, res) => {
        const body = await readJson(req);
        const result = await extractProblems({
          text: typeof body.text === 'string' ? body.text : '',
          imagePath: typeof body.imagePath === 'string' ? body.imagePath : '',
        });
        sendJson(res, 200, result);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/ai\/test$/,
      handler: async (req, res) => {
        const body = await readJson(req);
        const mode = body.mode === 'vision' ? 'vision' : 'text';
        const result = await testConnection(mode);
        sendJson(res, 200, { ok: true, ...result });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/export$/,
      handler: async (_req, res) => {
        const buffer = exportZip(repo);
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="errnote-${stamp}.zip"`,
          'Content-Length': buffer.length,
        });
        res.end(buffer);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/import$/,
      handler: async (req, res) => {
        const buffer = await readBody(req, ZIP_LIMIT);
        if (buffer.length === 0) throw new HttpError(400, 'NO_FILE', '没有收到备份文件');
        let result: { problems: number; images: number };
        try {
          result = importZip(repo, buffer);
        } catch (error) {
          throw new HttpError(400, 'IMPORT_FAILED', error instanceof Error ? error.message : '导入失败');
        }
        sendJson(res, 200, result);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/open-data-dir$/,
      handler: async (_req, res) => {
        openDataDir();
        sendJson(res, 200, { ok: true, dir: dataDir() });
      },
    },
  ];

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'GET' && pathname.startsWith('/images/')) {
      const name = path.basename(pathname);
      const file = path.join(dataDir(), 'images', name);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (serveStatic(res, file)) return;
      throw new HttpError(404, 'NOT_FOUND', '图片不存在');
    }

    if (pathname.startsWith('/api/')) {
      for (const route of routes) {
        if (route.method !== method) continue;
        if (!route.pattern.test(pathname)) continue;
        await route.handler(req, res, url);
        return;
      }
      throw new HttpError(404, 'NOT_FOUND', `接口不存在：${method} ${pathname}`);
    }

    if (method === 'GET' || method === 'HEAD') {
      const dist = distDir();
      if (!fs.existsSync(dist)) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('前端还没有构建：请运行 npm run build（开发时用 npm run dev）');
        return;
      }
      const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
      const candidate = path.join(dist, safePath);
      if (candidate.startsWith(dist) && serveStatic(res, candidate)) return;
      if (serveStatic(res, path.join(dist, 'index.html'))) return;
    }

    throw new HttpError(404, 'NOT_FOUND', '页面不存在');
  }

  return (req, res) => {
    handle(req, res).catch((error) => sendError(res, error));
  };
}
