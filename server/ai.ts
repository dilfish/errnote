import { loadConfig, isTextAiReady, isVisionAiReady, type AiConfig, type HeaderMap } from './config.ts';
import { normalizeDraftList, type Problem, type ProblemDraft } from './model.ts';
import { readImageAsDataUrl } from './images.ts';
import {
  DIFFICULTIES,
  GENERIC_SUBJECT,
  renderPrompt,
  resolvePrompt,
  type Difficulty,
} from './prompts.ts';

export class AiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  hint: string;

  constructor(message: string, status = 502, code = 'AI_ERROR', detail = '', hint = '') {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.hint = hint;
  }
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

const SYSTEM_PROMPT = `你是一位中小学老师的错题整理助手，任务是把图片或文字中的题目整理成结构化数据。

只输出一个 JSON 对象，禁止输出任何解释文字，禁止使用 markdown 代码块。

JSON 结构：
{"items":[{"subject":"","grade":"","problemType":"","stem":"","options":[{"key":"A","text":""}],"answer":"","analysis":"","knowledgePoints":[""]}]}

字段要求：
1. subject：只能从 语文、数学、英语、物理、化学、生物、政治、历史、地理、科学、其他 里选一个。
2. grade：能判断就写（如"三年级""五年级"），判断不出写空字符串。
3. problemType：从 选择题、填空题、判断题、计算题、解答题、应用题、其他 里选一个。
4. stem：题干原文，去掉题号、页眉页脚、手写批注；数学式子用普通文本，必要时用 LaTeX。
5. options：选择题才有，key 是选项字母，text 是选项内容；非选择题输出空数组 []。
6. answer：正确答案；题目没给答案时你自己解出来，只写最终答案。
7. analysis：2~4 句解题思路，点出关键步骤。
8. knowledgePoints：1~4 个具体知识点，例如"一元二次方程判别式""现在完成时"，不要写"数学""英语"这类宽泛的词。
9. 不要编造题目里不存在的条件；看不清的字用"□"代替，不要猜。

items 最多 5 道题，按原图顺序排列。`;

const IMAGE_PROMPT =
  '请识别图片中的题目，整理成约定的 JSON。图片里有多道题就按顺序全部输出（最多 5 道）。如果图片看不清、不是题目或没有可识别内容，items 输出 []。';

const TEXT_PROMPT = (text: string) =>
  `请把下面的题目整理成约定的 JSON，并补全答案、解析和知识点：\n\n${text}`;

const REPAIR_PROMPT =
  '你上一条回复不是合法 JSON，或缺少题干。请重新输出，只输出 JSON 对象本身，不要代码块、不要解释。';

/** 16x16 纯红 PNG，用于「测试识图」 */
export const TEST_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGO4o6b2nxLMMGrAqAGjBgwXAwBJIScfzetaYgAAAABJRU5ErkJggg==';

function endpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** 把上游错误体压成一句人话 */
export function upstreamMessage(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const nested = parsed?.error as Record<string, unknown> | string | undefined;
    const message =
      (nested && typeof nested === 'object' ? nested.message : nested) ??
      parsed?.message ??
      parsed?.detail ??
      parsed?.error_description;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // 不是 JSON，直接用原文
  }
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

function hintFor(status: number, message: string): string {
  const text = message.toLowerCase();
  if (/session/.test(text)) {
    return '这个网关要求额外的请求头：在 data/config.json 的 headers 里补上（例如 "x-opencode-session": "errnote"），保存即生效';
  }
  if (/response_format|json_object|json mode/.test(text)) {
    return '该服务商不支持强制 JSON 输出：把 data/config.json 里的 jsonMode 改成 false 再试';
  }
  if (/model/.test(text) && /(not|invalid|unknown|exist|support|unauthorized)/.test(text)) {
    return '模型名可能写错或没开通：检查 config.json 里的 model / visionModel';
  }
  if (/image|vision|multi.?modal/.test(text)) {
    return '当前模型可能不支持看图：给 visionModel 配一个视觉模型（如 qwen-vl-max），或改用文字输入';
  }
  if (/api.?key|unauthorized|invalid.*token|auth/.test(text)) {
    return 'Key 可能填错或已失效：检查 config.json 里的 apiKey';
  }
  if (status === 404) {
    return '接口地址可能不对：baseURL 一般要以 /v1 结尾，例如 https://api.deepseek.com/v1';
  }
  return '';
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object') {
          const obj = part as Record<string, unknown>;
          if (typeof obj.text === 'string') return obj.text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** 从模型输出里抠出 JSON（容忍代码块、前后废话） */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // 继续尝试截取
  }
  const objectStart = cleaned.indexOf('{');
  const objectEnd = cleaned.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const slice = cleaned.slice(objectStart, objectEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // 继续尝试数组
    }
  }
  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
    } catch {
      // 放弃
    }
  }
  throw new AiError('AI 返回的内容不是合法 JSON', 502, 'AI_BAD_JSON', cleaned.slice(0, 400));
}

type ChatOptions = {
  config: AiConfig;
  model: string;
  baseURL: string;
  apiKey: string;
  headers: HeaderMap;
  messages: ChatMessage[];
  jsonMode: boolean;
};

function buildHeaders(options: ChatOptions): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  // 自定义头最后合并，允许覆盖默认值（例如某些网关要自带 Authorization）
  for (const [name, value] of Object.entries(options.headers)) {
    if (name && value) headers[name] = value;
  }
  return headers;
}

async function requestOnce(options: ChatOptions, jsonMode: boolean): Promise<string> {
  const url = endpoint(options.baseURL);
  if (!url) throw new AiError('未配置 AI 接口地址（config.json 的 baseURL）', 400, 'AI_NOT_CONFIGURED');

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.config.temperature,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(options),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.config.timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiError(`AI 请求超时（${Math.round(options.config.timeoutMs / 1000)} 秒）`, 504, 'AI_TIMEOUT');
    }
    throw new AiError(
      `无法连接 AI 接口：${error instanceof Error ? error.message : String(error)}`,
      502,
      'AI_UNREACHABLE',
      '',
      '检查 config.json 的 baseURL 是否可访问；本地模型要确认服务已启动',
    );
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const upstream = upstreamMessage(raw);
    const detail = raw.slice(0, 800);
    let code = 'AI_UPSTREAM';
    let message = `AI 接口返回 ${response.status}${upstream ? `：${upstream.slice(0, 200)}` : ''}`;
    if (response.status === 401 || response.status === 403) {
      code = 'AI_AUTH';
      message = `AI 鉴权失败${upstream ? `：${upstream.slice(0, 160)}` : ''}`;
    } else if (response.status === 429) {
      code = 'AI_RATE_LIMIT';
      message = 'AI 接口限流或额度不足，请稍后再试';
    }
    const error = new AiError(message, 502, code, detail, hintFor(response.status, upstream || raw));

    if (jsonMode && (response.status === 400 || response.status === 422)) {
      // 个别服务商不支持 response_format，去掉再试一次
      try {
        return await requestOnce({ ...options, jsonMode: false }, false);
      } catch (retryError) {
        if (retryError instanceof AiError && /response_format|json_object/i.test(upstream)) {
          throw retryError;
        }
        throw error;
      }
    }
    throw error;
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const choices = data?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AiError('AI 返回格式异常（没有 choices）', 502, 'AI_BAD_RESPONSE', JSON.stringify(data).slice(0, 400));
  }
  const message = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  const text = contentToText(message?.content).trim();
  if (!text) throw new AiError('AI 返回了空内容', 502, 'AI_EMPTY', '');
  return text;
}

async function requestAndParse(options: ChatOptions): Promise<ProblemDraft[]> {
  const first = await requestOnce(options, options.config.jsonMode);
  const parsed = parseDrafts(first);
  if (parsed.length > 0) return parsed;

  const repairMessages: ChatMessage[] = [
    ...options.messages,
    { role: 'assistant', content: first },
    { role: 'user', content: REPAIR_PROMPT },
  ];
  const second = await requestOnce({ ...options, messages: repairMessages }, options.config.jsonMode);
  const repaired = parseDrafts(second);
  if (repaired.length > 0) return repaired;
  throw new AiError('AI 没能识别出题目，请换一张更清晰的图片或改用手动输入', 502, 'AI_NO_RESULT', second.slice(0, 400));
}

function parseDrafts(text: string): ProblemDraft[] {
  try {
    const json = extractJson(text);
    return normalizeDraftList(json, false);
  } catch (error) {
    if (error instanceof AiError) return [];
    return [];
  }
}

export type ExtractResult = {
  items: ProblemDraft[];
  model: string;
  imagePath: string | null;
};

export type ExtractInput = {
  text?: string;
  imagePath?: string;
  imageDataUrl?: string;
};

/** 识别题目：图片优先，其次文字 */
export async function extractProblems(input: ExtractInput): Promise<ExtractResult> {
  const text = (input.text ?? '').trim();
  const imagePath = input.imagePath?.trim() || '';
  const dataUrl = input.imageDataUrl?.trim() || '';
  if (!text && !imagePath && !dataUrl) {
    throw new AiError('请先上传图片或输入题目文字', 400, 'NO_INPUT');
  }

  const config = loadConfig();

  if (imagePath || dataUrl) {
    if (!isVisionAiReady(config)) {
      throw new AiError('未配置视觉模型：请在 data/config.json 填写 apiKey（图片识别需要能看图的模型）', 400, 'AI_NOT_CONFIGURED');
    }
    const url = dataUrl || readImageAsDataUrl(imagePath);
    const model = config.visionModel || config.model;
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: text ? `${IMAGE_PROMPT}\n\n补充说明：${text}` : IMAGE_PROMPT },
          { type: 'image_url', image_url: { url } },
        ],
      },
    ];
    const items = await requestAndParse({
      config,
      model,
      baseURL: config.visionBaseURL || config.baseURL,
      apiKey: config.visionApiKey || config.apiKey,
      headers: { ...config.headers, ...config.visionHeaders },
      messages,
      jsonMode: config.jsonMode,
    });
    return { items, model, imagePath: imagePath || null };
  }

  if (!isTextAiReady(config)) {
    throw new AiError('未配置 AI：请在 data/config.json 填写 apiKey', 400, 'AI_NOT_CONFIGURED');
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: TEXT_PROMPT(text) },
  ];
  const items = await requestAndParse({
    config,
    model: config.model,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    headers: config.headers,
    messages,
    jsonMode: config.jsonMode,
  });
  return { items, model: config.model, imagePath: null };
}

export type TestResult = {
  mode: 'text' | 'vision';
  model: string;
  latencyMs: number;
  sample: string;
};

/** 「测试连接」：各发一个最小请求，验证 baseURL / key / 模型 / 请求头是否可用 */
export async function testConnection(mode: 'text' | 'vision'): Promise<TestResult> {
  const config = loadConfig();
  const isVision = mode === 'vision';
  const ready = isVision ? isVisionAiReady(config) : isTextAiReady(config);
  if (!ready) {
    throw new AiError(
      isVision ? '视觉模型还没配置：在 data/config.json 填 visionModel（或复用 model）' : '还没配置 AI：在 data/config.json 填 apiKey',
      400,
      'AI_NOT_CONFIGURED',
    );
  }

  const model = isVision ? config.visionModel || config.model : config.model;
  const messages: ChatMessage[] = isVision
    ? [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么颜色？只回答颜色，不要解释。' },
            { type: 'image_url', image_url: { url: TEST_IMAGE } },
          ],
        },
      ]
    : [{ role: 'user', content: '只回答两个字：正常' }];

  const started = Date.now();
  const text = await requestOnce(
    {
      config,
      model,
      baseURL: isVision ? config.visionBaseURL || config.baseURL : config.baseURL,
      apiKey: isVision ? config.visionApiKey || config.apiKey : config.apiKey,
      headers: isVision ? { ...config.headers, ...config.visionHeaders } : config.headers,
      messages,
      jsonMode: false,
    },
    false,
  );
  return { mode, model, latencyMs: Date.now() - started, sample: text.slice(0, 120) };
}

export type GeneratePracticeResult = {
  items: ProblemDraft[];
  model: string;
  difficulty: Difficulty;
  prompt: string;
};

/** 错题练习：按「学科 + 难度」的提示词模板，让 AI 基于一道原题重出一道新题 */
export async function generatePractice(problem: Problem, difficulty: Difficulty): Promise<GeneratePracticeResult> {
  const config = loadConfig();
  if (!isTextAiReady(config)) {
    throw new AiError('未配置 AI：请在 data/config.json 填写 apiKey', 400, 'AI_NOT_CONFIGURED');
  }
  const subject = problem.subject?.trim() || GENERIC_SUBJECT;
  const label = DIFFICULTIES.find((item) => item.key === difficulty)?.label ?? difficulty;
  const template = resolvePrompt(subject, difficulty);
  const optionsText = problem.options.length
    ? problem.options.map((option) => `${option.key}. ${option.text}`).join('\n')
    : '（无）';
  const vars = {
    subject: problem.subject || '未标学科',
    grade: problem.grade || '',
    stem: problem.stem,
    options: optionsText,
    answer: problem.answer,
    analysis: problem.analysis,
    knowledgePoints: problem.knowledgePoints.join('、') || '（未标）',
  };
  const instruction = renderPrompt(template, vars);
  const original = [
    `原题（${vars.subject}${problem.grade ? ` ${problem.grade}` : ''}）：`,
    `题干：${problem.stem}`,
    problem.options.length ? `选项：\n${optionsText}` : '',
    `答案：${problem.answer}`,
    problem.analysis ? `解析：${problem.analysis}` : '',
    `知识点：${vars.knowledgePoints}`,
  ]
    .filter(Boolean)
    .join('\n');

  const userPrompt = [
    `请根据下面的原题，按「${label}」难度改写要求生成 1 道新题。`,
    '',
    original,
    '',
    `改写要求（难度：${label}）：`,
    instruction,
    '',
    '只输出 1 道题（items 数组里只有一个元素），格式遵守约定的 JSON；解析里要说明新题和原题的对应关系。',
  ].join('\n');

  const items = await requestAndParse({
    config,
    model: config.model,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    headers: config.headers,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    jsonMode: config.jsonMode,
  });
  if (items.length === 0) {
    throw new AiError('AI 没能生成新题，换个难度或再试一次', 502, 'AI_NO_RESULT');
  }
  return { items: items.slice(0, 1), model: config.model, difficulty, prompt: instruction };
}
