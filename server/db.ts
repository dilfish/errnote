import { DatabaseSync } from 'node:sqlite';
import {
  normalizeDraft,
  type Problem,
  type ProblemDraft,
  type ProblemFilter,
  type ProblemOption,
} from './model.ts';

const SCHEMA_VERSION = 3;

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
    unit: String(row.unit ?? ''),
    semester: String(row.semester ?? ''),
    problemType: String(row.problem_type ?? ''),
    source: String(row.source ?? ''),
    imagePath: row.image_path ? String(row.image_path) : null,
    wrongCount: Number(row.wrong_count ?? 0),
    wrongTimes: row.wrong_times ? String(row.wrong_times).split('|').filter(Boolean) : [],
    mastered: Number(row.mastered ?? 0) === 1,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/** 最近 8 次错误时间，倒序拼接，避免列表查询 N+1 */
const WRONG_TIMES_SELECT = `(
  SELECT group_concat(created_at, '|') FROM (
    SELECT created_at FROM error_events
    WHERE problem_id = problems.id
    ORDER BY created_at DESC
    LIMIT 8
  )
) AS wrong_times`;

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
      unit TEXT NOT NULL DEFAULT '',
      semester TEXT NOT NULL DEFAULT '',
      problem_type TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      image_path TEXT,
      wrong_count INTEGER NOT NULL DEFAULT 1,
      mastered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_problems_subject ON problems(subject);
    CREATE INDEX IF NOT EXISTS idx_problems_created ON problems(created_at DESC);

    CREATE TABLE IF NOT EXISTS error_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_error_events_problem ON error_events(problem_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_error_events_time ON error_events(created_at);
  `);

  if (version >= 1) {
    // 老库升级：补上单元/学期/题型三列
    const columns = new Set(
      (db.prepare('PRAGMA table_info(problems)').all() as Row[]).map((row) => String(row.name)),
    );
    const addColumn = (name: string, definition: string) => {
      if (!columns.has(name)) db.exec(`ALTER TABLE problems ADD COLUMN ${definition}`);
    };
    addColumn('unit', "unit TEXT NOT NULL DEFAULT ''");
    addColumn('semester', "semester TEXT NOT NULL DEFAULT ''");
    addColumn('problem_type', "problem_type TEXT NOT NULL DEFAULT ''");

    if (version === 1) {
      // v1 → v2：每道题补一条「记录时间」的错误记录，并把首次错误计入次数
      db.exec(`
        INSERT INTO error_events (problem_id, created_at)
        SELECT problems.id, problems.created_at FROM problems
        WHERE NOT EXISTS (SELECT 1 FROM error_events e WHERE e.problem_id = problems.id);

        UPDATE problems SET wrong_count = wrong_count + 1;
      `);
    }
  }

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
    const row = this.db
      .prepare(`SELECT problems.*, ${WRONG_TIMES_SELECT} FROM problems WHERE problems.id = ?`)
      .get(id) as Row | undefined;
    return row ? rowToProblem(row) : null;
  }

  list(filter: ProblemFilter = {}): { items: Problem[]; total: number } {
    const limit = Math.min(Math.max(Number(filter.limit ?? 20) || 20, 1), 200);
    const offset = Math.max(Number(filter.offset ?? 0) || 0, 0);
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.subject) {
      where.push('problems.subject = ?');
      params.push(filter.subject);
    }
    if (filter.grade) {
      where.push('problems.grade = ?');
      params.push(filter.grade);
    }
    if (filter.unit) {
      where.push('problems.unit = ?');
      params.push(filter.unit);
    }
    if (filter.semester) {
      where.push('problems.semester = ?');
      params.push(filter.semester);
    }
    if (filter.knowledgePoint) {
      where.push("problems.knowledge_points LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(filter.knowledgePoint)}%`);
    }
    if (typeof filter.mastered === 'boolean') {
      where.push('problems.mastered = ?');
      params.push(filter.mastered ? 1 : 0);
    }
    if (typeof filter.minWrongCount === 'number' && filter.minWrongCount > 0) {
      where.push('problems.wrong_count >= ?');
      params.push(Math.floor(filter.minWrongCount));
    }
    // 时间过滤看「任意一次错误时间」，只要有一次落在区间内就命中
    if (filter.createdBefore) {
      where.push(
        'EXISTS (SELECT 1 FROM error_events e WHERE e.problem_id = problems.id AND e.created_at <= ?)',
      );
      params.push(filter.createdBefore);
    }
    if (filter.createdAfter) {
      where.push(
        'EXISTS (SELECT 1 FROM error_events e WHERE e.problem_id = problems.id AND e.created_at >= ?)',
      );
      params.push(filter.createdAfter);
    }
    if (filter.q) {
      const needle = `%${likeEscape(filter.q)}%`;
      where.push(
        "(problems.stem LIKE ? ESCAPE '\\' OR problems.answer LIKE ? ESCAPE '\\' OR problems.analysis LIKE ? ESCAPE '\\' OR problems.knowledge_points LIKE ? ESCAPE '\\')",
      );
      params.push(needle, needle, needle, needle);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS n FROM problems ${clause}`).get(...params) as Row;
    const rows = this.db
      .prepare(
        `SELECT problems.*, ${WRONG_TIMES_SELECT} FROM problems ${clause} ORDER BY problems.id DESC LIMIT ? OFFSET ?`,
      )
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

  units(): { unit: string; n: number }[] {
    const rows = this.db
      .prepare("SELECT unit, COUNT(*) AS n FROM problems WHERE unit <> '' GROUP BY unit ORDER BY n DESC")
      .all() as Row[];
    return rows.map((row) => ({ unit: String(row.unit), n: Number(row.n) }));
  }

  semesters(): { semester: string; n: number }[] {
    const rows = this.db
      .prepare("SELECT semester, COUNT(*) AS n FROM problems WHERE semester <> '' GROUP BY semester ORDER BY n DESC")
      .all() as Row[];
    return rows.map((row) => ({ semester: String(row.semester), n: Number(row.n) }));
  }

  create(input: unknown, extra?: { source?: string; imagePath?: string | null }): Problem {
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const draft = normalizeDraft({ ...raw, ...extra }, { requireStem: true, requireAnswer: true });
    const mastered = raw.mastered === true || raw.mastered === 1 ? 1 : 0;
    const timestamp = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO problems
          (subject, grade, stem, options, answer, analysis, knowledge_points, unit, semester, problem_type, source, image_path, wrong_count, mastered, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        draft.subject,
        draft.grade,
        draft.stem,
        JSON.stringify(draft.options),
        draft.answer,
        draft.analysis,
        JSON.stringify(draft.knowledgePoints),
        draft.unit,
        draft.semester,
        draft.problemType,
        draft.source,
        draft.imagePath,
        mastered,
        timestamp,
        timestamp,
      );
    const id = Number(result.lastInsertRowid);
    this.addErrorEvent(id, timestamp);
    return this.get(id) as Problem;
  }

  /** 记一次错误时间 */
  addErrorEvent(problemId: number, at: string): void {
    this.db.prepare('INSERT INTO error_events (problem_id, created_at) VALUES (?, ?)').run(problemId, at);
  }

  update(id: number, input: unknown): Problem | null {
    const existing = this.get(id);
    if (!existing) return null;
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const draft: ProblemDraft = normalizeDraft(
      { ...existing, ...raw },
      { requireStem: true, requireAnswer: true },
    );
    const mastered =
      raw.mastered === undefined ? (existing.mastered ? 1 : 0) : raw.mastered === true || raw.mastered === 1 ? 1 : 0;
    this.db
      .prepare(
        `UPDATE problems SET subject=?, grade=?, stem=?, options=?, answer=?, analysis=?,
           knowledge_points=?, unit=?, semester=?, problem_type=?, source=?, image_path=?, wrong_count=?, mastered=?, updated_at=? WHERE id=?`,
      )
      .run(
        draft.subject,
        draft.grade,
        draft.stem,
        JSON.stringify(draft.options),
        draft.answer,
        draft.analysis,
        JSON.stringify(draft.knowledgePoints),
        draft.unit,
        draft.semester,
        draft.problemType,
        draft.source,
        draft.imagePath,
        existing.wrongCount,
        mastered,
        nowIso(),
        id,
      );
    return this.get(id);
  }

  markWrong(id: number): Problem | null {
    const existing = this.get(id);
    if (!existing) return null;
    const now = nowIso();
    this.addErrorEvent(id, now);
    this.db.prepare('UPDATE problems SET wrong_count = wrong_count + 1, updated_at = ? WHERE id = ?').run(now, id);
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
    const rows = this.db
      .prepare(`SELECT problems.*, ${WRONG_TIMES_SELECT} FROM problems ORDER BY problems.id ASC`)
      .all() as Row[];
    return rows.map(rowToProblem);
  }

  /** 导入用：保留原始字段，只重新分配 id */
  importDraft(
    draft: Partial<ProblemDraft> & {
      stem: string;
      createdAt?: string;
      wrongCount?: number;
      wrongTimes?: string[];
      mastered?: boolean;
    },
  ): Problem {
    const normalized = normalizeDraft(draft, { requireStem: true, requireAnswer: false });
    const timestamp = draft.createdAt || nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO problems
          (subject, grade, stem, options, answer, analysis, knowledge_points, unit, semester, problem_type, source, image_path, wrong_count, mastered, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        normalized.subject,
        normalized.grade,
        normalized.stem,
        JSON.stringify(normalized.options),
        normalized.answer,
        normalized.analysis,
        JSON.stringify(normalized.knowledgePoints),
        normalized.unit,
        normalized.semester,
        normalized.problemType,
        normalized.source,
        normalized.imagePath,
        Number(draft.wrongCount ?? 1),
        draft.mastered ? 1 : 0,
        timestamp,
        timestamp,
      );
    const id = Number(result.lastInsertRowid);
    const times = Array.isArray(draft.wrongTimes) && draft.wrongTimes.length > 0 ? draft.wrongTimes : [timestamp];
    for (const time of times) {
      if (typeof time === 'string' && time) this.addErrorEvent(id, time);
    }
    return this.get(id) as Problem;
  }
}
