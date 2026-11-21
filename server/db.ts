import { DatabaseSync } from 'node:sqlite';
import {
  normalizeDraft,
  type Problem,
  type ProblemDraft,
  type ProblemFilter,
  type ProblemOption,
} from './model.ts';

const SCHEMA_VERSION = 1;

type Row = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseOptions(raw: unknown): ProblemOption[] {
  try {
    const value = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(value) ? (value as ProblemOption[]) : [];
  } catch {
    return [];
  }
}

function parseKnowledge(raw: unknown): string[] {
  try {
    const value = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function rowToProblem(row: Row): Problem {
  return {
    id: Number(row.id),
    subject: String(row.subject ?? ''),
    grade: String(row.grade ?? ''),
    stem: String(row.stem ?? ''),
    options: parseOptions(row.options),
    answer: String(row.answer ?? ''),
    analysis: String(row.analysis ?? ''),
    knowledgePoints: parseKnowledge(row.knowledge_points),
    source: String(row.source ?? ''),
    imagePath: row.image_path ? String(row.image_path) : null,
    wrongCount: Number(row.wrong_count ?? 0),
    mastered: Number(row.mastered ?? 0) === 1,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as Row | undefined;
  const version = Number(row?.user_version ?? 0);
  if (version >= SCHEMA_VERSION) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS problems (
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
    CREATE INDEX IF NOT EXISTS idx_problems_subject ON problems(subject);
    CREATE INDEX IF NOT EXISTS idx_problems_created ON problems(created_at DESC);
  `);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export class ProblemRepo {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM problems').get() as Row;
    return Number(row.n ?? 0);
  }

  countImages(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM problems WHERE image_path IS NOT NULL AND image_path <> ''")
      .get() as Row;
    return Number(row.n ?? 0);
  }

  get(id: number): Problem | null {
    const row = this.db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToProblem(row) : null;
  }

  list(filter: ProblemFilter = {}): { items: Problem[]; total: number } {
    const limit = Math.min(Math.max(Number(filter.limit ?? 20) || 20, 1), 200);
    const offset = Math.max(Number(filter.offset ?? 0) || 0, 0);
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.subject) {
      where.push('subject = ?');
      params.push(filter.subject);
    }
    if (filter.grade) {
      where.push('grade = ?');
      params.push(filter.grade);
    }
    if (filter.knowledgePoint) {
      where.push("knowledge_points LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(filter.knowledgePoint)}%`);
    }
    if (typeof filter.mastered === 'boolean') {
      where.push('mastered = ?');
      params.push(filter.mastered ? 1 : 0);
    }
    if (filter.createdBefore) {
      where.push('created_at <= ?');
      params.push(filter.createdBefore);
    }
    if (filter.createdAfter) {
      where.push('created_at >= ?');
      params.push(filter.createdAfter);
    }
    if (filter.q) {
      const needle = `%${likeEscape(filter.q)}%`;
      where.push(
        "(stem LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\' OR analysis LIKE ? ESCAPE '\\' OR knowledge_points LIKE ? ESCAPE '\\')",
      );
      params.push(needle, needle, needle, needle);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS n FROM problems ${clause}`).get(...params) as Row;
    const rows = this.db
      .prepare(`SELECT * FROM problems ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Row[];

    return { items: rows.map(rowToProblem), total: Number(totalRow.n ?? 0) };
  }

  subjects(): { subject: string; n: number }[] {
    const rows = this.db
      .prepare("SELECT subject, COUNT(*) AS n FROM problems WHERE subject <> '' GROUP BY subject ORDER BY n DESC")
      .all() as Row[];
    return rows.map((row) => ({ subject: String(row.subject), n: Number(row.n) }));
  }

  grades(): { grade: string; n: number }[] {
    const rows = this.db
      .prepare("SELECT grade, COUNT(*) AS n FROM problems WHERE grade <> '' GROUP BY grade ORDER BY grade")
      .all() as Row[];
    return rows.map((row) => ({ grade: String(row.grade), n: Number(row.n) }));
  }

  create(input: unknown, extra?: { source?: string; imagePath?: string | null }): Problem {
    const draft = normalizeDraft({ ...(input as object), ...extra }, { requireStem: true, requireAnswer: true });
    const timestamp = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO problems
          (subject, grade, stem, options, answer, analysis, knowledge_points, source, image_path, wrong_count, mastered, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      )
      .run(
        draft.subject,
        draft.grade,
        draft.stem,
        JSON.stringify(draft.options),
        draft.answer,
        draft.analysis,
        JSON.stringify(draft.knowledgePoints),
        draft.source,
        draft.imagePath,
        timestamp,
        timestamp,
      );
    return this.get(Number(result.lastInsertRowid)) as Problem;
  }

  update(id: number, input: unknown): Problem | null {
    const existing = this.get(id);
    if (!existing) return null;
    const draft: ProblemDraft = normalizeDraft(
      { ...existing, ...(input as object) },
      { requireStem: true, requireAnswer: true },
    );
    this.db
      .prepare(
        `UPDATE problems SET subject=?, grade=?, stem=?, options=?, answer=?, analysis=?,
           knowledge_points=?, source=?, image_path=?, wrong_count=?, mastered=?, updated_at=? WHERE id=?`,
      )
      .run(
        draft.subject,
        draft.grade,
        draft.stem,
        JSON.stringify(draft.options),
        draft.answer,
        draft.analysis,
        JSON.stringify(draft.knowledgePoints),
        draft.source,
        draft.imagePath,
        existing.wrongCount,
        existing.mastered ? 1 : 0,
        nowIso(),
        id,
      );
    return this.get(id);
  }

  markWrong(id: number): Problem | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db.prepare('UPDATE problems SET wrong_count = wrong_count + 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
    return this.get(id);
  }

  setMastered(id: number, mastered: boolean): Problem | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db.prepare('UPDATE problems SET mastered = ?, updated_at = ? WHERE id = ?').run(mastered ? 1 : 0, nowIso(), id);
    return this.get(id);
  }

  remove(id: number): boolean {
    const result = this.db.prepare('DELETE FROM problems WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  all(): Problem[] {
    const rows = this.db.prepare('SELECT * FROM problems ORDER BY id ASC').all() as Row[];
    return rows.map(rowToProblem);
  }

  /** 导入用：保留原始字段，只重新分配 id */
  importDraft(draft: ProblemDraft & { createdAt?: string; wrongCount?: number; mastered?: boolean }): Problem {
    const normalized = normalizeDraft(draft, { requireStem: true, requireAnswer: false });
    const timestamp = draft.createdAt || nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO problems
          (subject, grade, stem, options, answer, analysis, knowledge_points, source, image_path, wrong_count, mastered, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        normalized.subject,
        normalized.grade,
        normalized.stem,
        JSON.stringify(normalized.options),
        normalized.answer,
        normalized.analysis,
        JSON.stringify(normalized.knowledgePoints),
        normalized.source,
        normalized.imagePath,
        Number(draft.wrongCount ?? 0),
        draft.mastered ? 1 : 0,
        timestamp,
        timestamp,
      );
    return this.get(Number(result.lastInsertRowid)) as Problem;
  }
}
