import fs from 'node:fs';
import { configFile, ensureDataDirs } from './paths.ts';

export type HeaderMap = Record<string, string>;

export type AiConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  headers: HeaderMap;
  visionBaseURL: string;
  visionApiKey: string;
  visionModel: string;
  visionHeaders: HeaderMap;
  temperature: number;
  timeoutMs: number;
  jsonMode: boolean;
};

/** 首次启动写入的配置文件全文（允许 // 注释） */
const CONFIG_TEMPLATE = `{
  // ===== 文本模型：整理文字题、补全答案与知识点 =====
  // 任何 OpenAI 兼容接口都可以：DeepSeek / 通义 / 豆包 / 硅基流动 / 本地 Ollama
  // 注意地址要带版本前缀，例如 https://api.deepseek.com/v1
  "baseURL": "https://api.deepseek.com/v1",
  "apiKey": "",
  "model": "deepseek-chat",

  // 有些网关要求额外的请求头，写在这里（键值都必须是字符串）
  // 例：opencode 网关需要 "x-opencode-session": "errnote"
  "headers": {},

  // ===== 视觉模型：拍照识别题目 =====
  // 留空表示复用上面的 baseURL / apiKey / model / headers（此时 model 必须是能看图的模型）
  // 常见搭配：baseURL https://dashscope.aliyuncs.com/compatible-mode/v1 + model qwen-vl-max
  "visionBaseURL": "",
  "visionApiKey": "",
  "visionModel": "",
  "visionHeaders": {},

  // 生成随机度，识别任务建议 0~0.3
  "temperature": 0.2,
  // 单次请求超时（毫秒）
  "timeoutMs": 60000,
  // 是否要求服务端返回纯 JSON（个别服务商不支持，会自动降级重试一次）
  "jsonMode": true
}
`;

const DEFAULTS: AiConfig = {
  baseURL: '',
  apiKey: '',
  model: '',
  headers: {},
  visionBaseURL: '',
  visionApiKey: '',
  visionModel: '',
  visionHeaders: {},
  temperature: 0.2,
  timeoutMs: 60000,
  jsonMode: true,
};

/** 去掉 JSON 文本里的 // 与 /* *\/ 注释（字符串内的不动） */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 确保配置文件存在；不存在时写入带注释的模板 */
export function ensureConfigFile(): string {
  ensureDataDirs();
  const file = configFile();
  if (!fs.existsSync(file)) fs.writeFileSync(file, CONFIG_TEMPLATE, 'utf8');
  return file;
}

function pickString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function pickNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 只接受 string→string 的扁平对象，值统一转字符串 */
function pickHeaders(source: Record<string, unknown>, key: string): HeaderMap {
  const value = source[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const headers: HeaderMap = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const headerName = name.trim();
    if (!headerName) continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      headers[headerName] = String(raw);
    }
  }
  return headers;
}

/** 每次请求都重新读配置，这样改完 config.json 不用重启 */
export function loadConfig(): AiConfig {
  const file = ensureConfigFile();
  const config: AiConfig = { ...DEFAULTS, baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
  try {
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as Record<string, unknown>;
    config.baseURL = pickString(parsed, 'baseURL', config.baseURL);
    config.apiKey = pickString(parsed, 'apiKey', '');
    config.model = pickString(parsed, 'model', config.model);
    config.headers = pickHeaders(parsed, 'headers');
    config.visionBaseURL = pickString(parsed, 'visionBaseURL', '');
    config.visionApiKey = pickString(parsed, 'visionApiKey', '');
    config.visionModel = pickString(parsed, 'visionModel', '');
    config.visionHeaders = pickHeaders(parsed, 'visionHeaders');
    config.temperature = pickNumber(parsed, 'temperature', config.temperature);
    config.timeoutMs = pickNumber(parsed, 'timeoutMs', config.timeoutMs);
    config.jsonMode = parsed.jsonMode === false ? false : true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`config.json 解析失败：${message}（文件：${file}）`);
  }
  // 环境变量优先级最高
  if (process.env.ERRNOTE_AI_BASE_URL) config.baseURL = process.env.ERRNOTE_AI_BASE_URL;
  if (process.env.ERRNOTE_AI_KEY) config.apiKey = process.env.ERRNOTE_AI_KEY;
  if (process.env.ERRNOTE_AI_MODEL) config.model = process.env.ERRNOTE_AI_MODEL;
  if (process.env.ERRNOTE_VISION_BASE_URL) config.visionBaseURL = process.env.ERRNOTE_VISION_BASE_URL;
  if (process.env.ERRNOTE_VISION_KEY) config.visionApiKey = process.env.ERRNOTE_VISION_KEY;
  if (process.env.ERRNOTE_VISION_MODEL) config.visionModel = process.env.ERRNOTE_VISION_MODEL;
  return config;
}

export class ConfigError extends Error {
  readonly status = 500;
  readonly code = 'CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function isTextAiReady(config: AiConfig): boolean {
  return Boolean(config.apiKey && config.baseURL && config.model);
}

export function isVisionAiReady(config: AiConfig): boolean {
  const baseURL = config.visionBaseURL || config.baseURL;
  const apiKey = config.visionApiKey || config.apiKey;
  const model = config.visionModel || config.model;
  return Boolean(apiKey && baseURL && model);
}

/** 给前端看的状态，绝不包含 key */
export function describeConfig(config: AiConfig) {
  return {
    configPath: configFile(),
    text: {
      ready: isTextAiReady(config),
      baseURL: config.baseURL,
      model: config.model,
      keySet: Boolean(config.apiKey),
      headerNames: Object.keys(config.headers),
    },
    vision: {
      ready: isVisionAiReady(config),
      baseURL: config.visionBaseURL || config.baseURL,
      model: config.visionModel || config.model,
      keySet: Boolean(config.visionApiKey || config.apiKey),
      headerNames: Object.keys({ ...config.headers, ...config.visionHeaders }),
    },
  };
}
