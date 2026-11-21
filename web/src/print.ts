export type PrintQuestion = {
  subject: string;
  grade: string;
  unit?: string;
  problemType?: string;
  stem: string;
  options: { key: string; text: string }[];
  answer: string;
  analysis: string;
  /** 可选：变式题的难度标签 */
  difficulty?: string;
};

export type PrintOptions = {
  /** 是否附带答案与解析（默认不带） */
  withAnswers?: boolean;
  title?: string;
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function buildPaperHtml(questions: PrintQuestion[], options: PrintOptions = {}): string {
  const withAnswers = options.withAnswers === true;
  const now = new Date();
  const dateText = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const subjects = unique(questions.map((item) => item.subject));
  const grades = unique(questions.map((item) => item.grade));
  const title = options.title || `${subjects.length === 1 ? subjects[0] : '错题'}练习卷`;

  const body = questions
    .map((item, index) => {
      const meta = [item.subject, item.grade, item.unit, item.problemType, item.difficulty].filter(Boolean).join(' · ');
      const optionsHtml = item.options.length
        ? `<ul class="options">${item.options
            .map((option) => `<li><b>${esc(option.key)}.</b> ${esc(option.text)}</li>`)
            .join('')}</ul>`
        : '';
      // 选择题留白少一点，解答题留出书写空间
      const space = item.options.length ? '' : '<div class="space"></div>';
      return `<section class="q">
  <div class="q-head"><span class="no">${index + 1}</span>${meta ? `<span class="q-meta">${esc(meta)}</span>` : ''}</div>
  <div class="q-body">${esc(item.stem)}</div>
  ${optionsHtml}${space}
</section>`;
    })
    .join('\n');

  const answers = withAnswers
    ? `<section class="answers">
    <h2>答案与解析</h2>
    ${questions
      .map(
        (item, index) => `<div class="a-item">
  <div class="a-head">第 ${index + 1} 题</div>
  <div class="a-line"><b>答案：</b>${esc(item.answer)}</div>
  ${item.analysis ? `<div class="a-line"><b>解析：</b>${esc(item.analysis)}</div>` : ''}
</div>`,
      )
      .join('\n')}
  </section>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111; background: #fff; font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Songti SC", serif; font-size: 15px; line-height: 1.8; }
  .toolbar { position: sticky; top: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 10px 0; background: #fff; border-bottom: 1px solid #eee; margin-bottom: 12px; }
  .toolbar button { font: inherit; padding: 6px 16px; border: 1px solid #2563eb; background: #2563eb; color: #fff; border-radius: 6px; cursor: pointer; }
  .toolbar button.ghost { background: #fff; color: #2563eb; }
  .paper { max-width: 190mm; margin: 0 auto; padding: 0 4mm; }
  h1 { font-size: 22px; text-align: center; margin: 8px 0 4px; letter-spacing: 2px; }
  .meta { text-align: center; color: #555; font-size: 13px; margin-bottom: 10px; }
  .info { display: flex; justify-content: space-between; font-size: 13.5px; border-bottom: 1px solid #333; padding-bottom: 6px; margin-bottom: 14px; }
  .q { margin: 0 0 8mm; page-break-inside: avoid; break-inside: avoid; }
  .q-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .no { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; border: 1px solid #333; border-radius: 50%; font-size: 13px; }
  .q-meta { color: #777; font-size: 12px; }
  .q-body { white-space: pre-wrap; word-break: break-word; font-size: 15.5px; }
  .options { list-style: none; margin: 4px 0 0; padding: 0 0 0 30px; display: flex; flex-wrap: wrap; }
  .options li { width: 50%; padding-right: 8px; }
  .space { height: 17mm; border-bottom: 1px dashed #ccc; margin: 4px 0 0 30px; }
  .answers { page-break-before: always; break-before: page; }
  .answers h2 { font-size: 18px; border-bottom: 1px solid #333; padding-bottom: 4px; }
  .a-item { margin-bottom: 12px; page-break-inside: avoid; break-inside: avoid; }
  .a-head { font-weight: 600; }
  .a-line { white-space: pre-wrap; word-break: break-word; }
  @media print {
    .toolbar { display: none; }
    body { font-size: 14.5px; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">打印 / 保存为 PDF</button>
  <button class="ghost" onclick="window.close()">关闭</button>
</div>
<main class="paper">
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(grades.join('、') || '')}${grades.length ? ' · ' : ''}${dateText} · 共 ${questions.length} 题${withAnswers ? ' · 含答案' : ''}</div>
  <div class="info"><span>姓名：____________</span><span>用时：________</span><span>得分：________</span></div>
  ${body}
  ${answers}
</main>
<script>
  window.addEventListener('load', function () {
    setTimeout(function () { window.print(); }, 300);
  });
</script>
</body>
</html>`;
}

/** 新窗口打开排版好的试卷并唤起打印 */
export function printPaper(questions: PrintQuestion[], options: PrintOptions = {}): void {
  if (questions.length === 0) return;
  const win = window.open('', '_blank');
  if (!win) {
    window.alert('浏览器拦截了新窗口，请允许本站弹出窗口后重试');
    return;
  }
  win.document.open();
  win.document.write(buildPaperHtml(questions, options));
  win.document.close();
  win.focus();
}
