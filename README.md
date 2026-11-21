# 错题本

给孩子的本地错题本：**拍照或粘贴文字 → AI 识别题目、补全答案、标出知识点 → 存进本机数据库 → 需要时翻出来复习**。

- 数据全部在自己的电脑上（`data/` 文件夹，拷走就是备份）
- 电脑、手机、平板连同一个 WiFi 都能用
- AI 走任意 **OpenAI 兼容接口**（DeepSeek / 通义 / 豆包 / 硅基流动 / 本地 Ollama 都行），Key 只在本地，前端拿不到
- 只依赖 Node.js，不需要 Electron 套壳

## 一、运行要求

- **Node.js 24 或更高**（内置 SQLite 需要它）：<https://nodejs.org/zh-cn>
- Windows 直接双击 `start.bat`
- macOS / Linux：

```bash
npm install
npm run build
npm start
```

首次启动会自动创建：

```
data/
├── config.json    ← 填 AI 的 Key 和模型
├── prompts.json   ← 「错题练习」每个学科的三档提示词（在「设置」里改）
├── errnote.db     ← 全部题目（SQLite）
└── images/        ← 拍照上传的原图
```

服务默认监听 `0.0.0.0:8787`，启动日志会打印手机访问地址（同一 WiFi 下打开即可）。手机浏览器里还可以「添加到主屏幕」，用起来像 App。

## 二、配置 AI（必须做）

用记事本 / VS Code 打开 `data/config.json`（支持 `//` 注释），填三样东西：

```json
{
  // 文本模型：整理文字题、补全答案和知识点
  "baseURL": "https://api.deepseek.com/v1",
  "apiKey": "sk-你的key",
  "model": "deepseek-chat",

  // 有些网关要求额外请求头，写在这里（键值都必须是字符串）
  "headers": {},

  // 视觉模型：拍照识别题目（必须是能看图的模型）
  "visionBaseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "visionApiKey": "sk-你的key",
  "visionModel": "qwen-vl-max",
  "visionHeaders": {},

  "temperature": 0.2,
  "timeoutMs": 60000,
  "jsonMode": true
}
```

说明：

- `baseURL` 要带版本前缀（一般以 `/v1` 结尾）。程序会请求 `${baseURL}/chat/completions`。
- 视觉相关的几项**留空就复用**上面的 `baseURL / apiKey / model / headers`，前提是该模型能看图（如 `gpt-4o-mini`、`qwen-vl-max`）。
- 只做文字整理、不拍照的话，视觉几项可以不填。
- 改完保存**立即生效**，不用重启服务。
- 有些网关需要额外请求头（例如 opencode 网关要 `x-opencode-session`），写进 `headers` 即可：

  ```json
  "headers": { "x-opencode-session": "errnote" }
  ```

- 也可以用环境变量覆盖：`ERRNOTE_AI_BASE_URL`、`ERRNOTE_AI_KEY`、`ERRNOTE_AI_MODEL`、`ERRNOTE_VISION_BASE_URL`、`ERRNOTE_VISION_KEY`、`ERRNOTE_VISION_MODEL`。

配好后在「加题目」页顶部点 **测试文本 / 测试识图**，两个都是绿字就说明通了；失败时会直接显示上游的真实报错和修复建议。

常见服务商示例：

| 服务商 | baseURL | 文本模型 | 视觉模型 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | 不支持，需另配视觉 |
| 阿里通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `qwen-vl-max` |
| 豆包（火山方舟） | `https://ark.cn-beijing.volces.com/api/v3` | 你在方舟创建的接入点 ID | 同左，选视觉模型 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` | `Qwen/Qwen2.5-VL-72B-Instruct` |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` | `qwen2.5vl:7b` |

> 用 opencode 的 go 网关（`https://opencode.ai/inference/go/v1`）时，该网关要求带 `x-opencode-session` 请求头，写成 `"headers": { "x-opencode-session": "errnote" }` 即可。

## 三、日常使用

三个页面：

- **错题练习**：选学科 + 年级 + 错误次数（默认 1 次以上）+ 时间范围，列出符合条件的旧错题；同一道题错过多次时，任意一次错误时间落在范围内就会列出。
  - **打印试卷**：打印的是当前筛选出的全部错题，勾选「打印时带答案」会多一页答案与解析（默认不带）
  - 每道题后面选「容易 / 中等 / 难」，点「AI 重新生成」出一道变式题；变式题只在屏幕上练习，不入库，原错题不变
  - 三个难度提示词按学科分别保存，可以在右上角「设置」里改，也能一键恢复默认
- **错题本**：搜索、按学科/年级筛选、编辑、删除、「又错了 +1」、「标记已掌握」
- **加题目**：拍照或贴文字，AI 整理成结构化错题

具体流程：

1. 打开「加题目」
2. 手机点「拍照」，电脑点「选图片」；图片会自动压到长边 1280、约 100~300KB
3. AI 自动识别出题干、选项、答案、解析、知识点，**逐个卡片核对，改完点保存**
   - 题干和答案都必填；没解出来可以先写「待解」，或先点「AI 整理」让它补
4. 也可以把文字粘到第二个框里，点「AI 整理文字」
5. 过几天去「错题练习」，挑旧错题让 AI 出同知识点的新题

## 四、备份与搬家

- **备份**：点页面右上角「备份」，会下载 `errnote-YYYYMMDD.zip`（题目 + 图片）
- **恢复**：在新机器上启动后点「导入」，选择 zip 即可（追加导入，不会覆盖已有数据）
- 也可以直接复制整个 `data/` 文件夹，换电脑时整包拷过去

## 五、命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式：前端 5173（热更新）+ 后端 8787 |
| `npm run build` | 构建前端到 `web/dist` |
| `npm start` | 启动服务（先 build） |
| `npm test` | 后端 + API 自动化测试（用假 AI 服务，不需要 Key） |
| `npm run typecheck` | 前后端 TypeScript 类型检查 |
| `npm run seed:load` | 造 5000 道题 + 200 张图做压测，写到 `.seed-data/`，不动真实数据 |
| `npm run seed:demo` | 往 `data/` 追加 45 道示例题（数学/语文/英语，日期随机分布在近 120 天） |
| `npm run seed:demo -- --clear` | 只删除示例题（`source = 示例`），自己录的不受影响 |
| `npm run icons` | 重新生成 PWA 图标 |

## 六、常见问题

**页面提示「未配置 AI」**
`data/config.json` 里的 `apiKey` 还是空的，填上保存即可。

**拍照识别失败，提示视觉模型未就绪**
`visionModel` 没填，或者填的模型不能看图。也可以继续用文字输入。

**提示「AI 接口返回 400」**
页面会把上游返回的原话一起显示出来，按提示改就行。最常见的是三种：`baseURL` 少了 `/v1`、模型名写错、网关要求额外请求头（填到 `headers` 里）。改完保存立即生效，再点「测试文本」验证。

**提示 `response_format` 相关错误**
程序会自动去掉该参数重试一次；如果仍失败，把 `jsonMode` 设成 `false`。

**手机打不开**
确认手机和电脑在同一个 WiFi；Windows 防火墙第一次会弹窗，要允许「专用网络」；公司网络/校园网可能隔离设备。

**数据会不会丢**
不会自动丢。注意别点浏览器「清除浏览数据」——数据不在浏览器里，在 `data/` 文件夹。记得定期点「备份」。

## 七、目录结构

```
server/          后端（零框架，Node 内置 http + node:sqlite）
  app.ts         REST 路由
  ai.ts          OpenAI 兼容调用、识别、按难度重出题
  prompts.ts     三档提示词模板（按学科，可覆盖，带占位符替换）
  db.ts          SQLite 建表与增删改查
  config.ts      config.json 读取（支持注释、热更新）
  images.ts      图片上传/读取
  backup.ts      zip 导出/导入
web/             前端（React + Vite）
  src/pages/Practice.tsx     错题练习：按学科/时间筛选 + AI 重出题
  src/pages/AddProblem.tsx   拍照/文字 → AI → 入库
  src/pages/Library.tsx      题库列表
  src/pages/Settings.tsx     提示词编辑
  src/components/ProblemCard.tsx  可编辑题目卡片
scripts/         开发脚本（示例数据、压测、图标）
data/            运行期数据（不进 git）
```

提示词里可用的占位符：`{stem}` `{options}` `{answer}` `{analysis}` `{knowledgePoints}` `{grade}` `{subject}`，生成前会被替换成原题内容。
