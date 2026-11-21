import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { ProblemRepo } from './db.ts';
import { ensureDataDirs, imagesDir } from './paths.ts';
import type { Problem, ProblemDraft } from './model.ts';
import { isImagePath } from './images.ts';

const MANIFEST = { app: 'errnote', version: 1 };

export type ImportResult = {
  problems: number;
  images: number;
};

export function exportZip(repo: ProblemRepo): Buffer {
  const zip = new AdmZip();
  const problems = repo.all();
  zip.addFile(
    'metadata.json',
    Buffer.from(JSON.stringify({ ...MANIFEST, exportedAt: new Date().toISOString(), count: problems.length }, null, 2)),
  );
  zip.addFile('problems.json', Buffer.from(JSON.stringify(problems, null, 2)));
  const dir = imagesDir();
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isFile()) zip.addFile(`images/${name}`, fs.readFileSync(file));
    }
  }
  return zip.toBuffer();
}

export function importZip(repo: ProblemRepo, buffer: Buffer): ImportResult {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('problems.json');
  if (!entry) throw new Error('压缩包里没有 problems.json，不是有效的错题本备份');
  const parsed = JSON.parse(entry.getData().toString('utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('problems.json 内容不是数组');

  ensureDataDirs();
  let files = 0;
  for (const item of zip.getEntries()) {
    if (!item.entryName.startsWith('images/') || item.isDirectory) continue;
    const name = path.basename(item.entryName);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    const target = path.join(imagesDir(), name);
    if (!fs.existsSync(target)) fs.writeFileSync(target, item.getData());
    files += 1;
  }

  let imported = 0;
  for (const raw of parsed) {
    const draft = raw as Problem & Partial<ProblemDraft>;
    if (!draft || typeof draft !== 'object' || !draft.stem) continue;
    repo.importDraft({
      subject: draft.subject ?? '',
      grade: draft.grade ?? '',
      stem: draft.stem,
      options: Array.isArray(draft.options) ? draft.options : [],
      answer: draft.answer ?? '',
      analysis: draft.analysis ?? '',
      knowledgePoints: Array.isArray(draft.knowledgePoints) ? draft.knowledgePoints : [],
      source: draft.source ?? '导入',
      imagePath: draft.imagePath && isImagePath(draft.imagePath) ? draft.imagePath : null,
      createdAt: draft.createdAt,
      wrongCount: draft.wrongCount,
      wrongTimes: Array.isArray(draft.wrongTimes) ? draft.wrongTimes : undefined,
      mastered: draft.mastered,
    });
    imported += 1;
  }
  return { problems: imported, images: files };
}
