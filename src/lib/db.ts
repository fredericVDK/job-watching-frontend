import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Job, JobStatus, RunInfo, Stats, View } from '@/types';

export const DB_PATH = process.env.JOBWATCHER_DB || path.join(process.cwd(), 'data', 'jobwatcher.db');

function open(readOnly = true): DatabaseSync | null {
  if (!existsSync(DB_PATH)) return null;
  const db = new DatabaseSync(DB_PATH, { readOnly });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

type Row = Record<string, unknown>;

/** node:sqlite weigert parameters die niet in de query voorkomen -> enkel de gebruikte meegeven. */
function bind(sql: string, params: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(params).filter(([k]) => sql.includes(`:${k}`)));
}

function lastDoneRunId(db: DatabaseSync): number {
  const r = db.prepare("SELECT MAX(id) AS id FROM runs WHERE status = 'done'").get() as Row | undefined;
  return Number(r?.id ?? 0);
}

const VIEW_SQL: Record<View, string> = {
  new: "first_run_id = :lastRun AND status <> 'hidden'",
  todo: "status = 'new'",
  saved: "status = 'saved'",
  applied: "status = 'applied'",
  hidden: "status = 'hidden'",
  all: "status <> 'hidden'",
};

export interface JobQuery {
  view: View;
  q?: string;
  cv?: string;
  minScore?: number;
  sort?: 'score' | 'date';
}

export function listJobs({ view, q, cv, minScore = 0, sort = 'score' }: JobQuery): Job[] {
  const db = open();
  if (!db) return [];
  try {
    const lastRun = lastDoneRunId(db);
    const where = [VIEW_SQL[view] ?? VIEW_SQL.all, 'score >= :minScore'];
    const params: Record<string, string | number> = { lastRun, minScore };
    if (q) {
      where.push("(title LIKE :q OR company LIKE :q OR location LIKE :q OR matched LIKE :q OR description LIKE :q)");
      params.q = `%${q}%`;
    }
    if (cv) {
      where.push('best_cv = :cv');
      params.cv = cv;
    }
    const order = sort === 'date' ? 'first_seen_at DESC, score DESC' : 'score DESC, first_seen_at DESC';
    const sql = `SELECT id, url, source, company, title, location, remote, substr(description, 1, 600) AS snippet, posted_at,
                first_seen_at, last_seen_at, first_run_id, score, best_cv, matched, status, status_at
         FROM jobs WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`;
    const rows = db.prepare(sql).all(bind(sql, params)) as Row[];

    // Laatste succesvolle run waarin de bron gecheckt werd -> wat daarna niet meer gezien is, is wellicht offline.
    const lastRunAt = (db.prepare("SELECT started_at FROM runs WHERE status = 'done' ORDER BY id DESC LIMIT 1 OFFSET 1").get() as Row | undefined)?.started_at as string | undefined;

    return rows.map((r) => ({
      ...(r as unknown as Job),
      remote: Boolean(r.remote),
      matched: JSON.parse(String(r.matched || '[]')),
      stale: lastRunAt ? String(r.last_seen_at) < lastRunAt : false,
    }));
  } finally {
    db.close();
  }
}

export function setStatus(id: number, status: JobStatus) {
  const db = open(false);
  if (!db) throw new Error('Database bestaat nog niet');
  try {
    db.prepare('UPDATE jobs SET status = ?, status_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  } finally {
    db.close();
  }
}

/** Markeert een job als 'bekeken' als die nog 'nieuw' was. */
export function markSeen(id: number) {
  const db = open(false);
  if (!db) return;
  try {
    db.prepare("UPDATE jobs SET status = 'seen', status_at = ? WHERE id = ? AND status = 'new'").run(new Date().toISOString(), id);
  } finally {
    db.close();
  }
}

function parseRun(r: Row): RunInfo {
  return { ...(r as unknown as RunInfo), sources: r.sources ? JSON.parse(String(r.sources)) : null };
}

export function getStats(): Stats {
  const empty: Stats = {
    counts: { new: 0, todo: 0, saved: 0, applied: 0, hidden: 0, all: 0 },
    lastRun: null,
    runs: [],
    profiles: [],
    running: false,
  };
  const db = open();
  if (!db) return empty;
  try {
    const lastRun = lastDoneRunId(db);
    const counts = { ...empty.counts };
    for (const view of Object.keys(VIEW_SQL) as View[]) {
      const sql = `SELECT COUNT(*) AS n FROM jobs WHERE ${VIEW_SQL[view]}`;
      const r = db.prepare(sql).get(bind(sql, { lastRun })) as Row;
      counts[view] = Number(r.n);
    }
    const runs = (db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 14').all() as Row[]).map(parseRun);
    const running = runs.some(
      (r) => r.status === 'running' && Date.now() - new Date(r.started_at).getTime() < 30 * 60 * 1000,
    );
    const profiles = (db.prepare('SELECT DISTINCT best_cv FROM jobs WHERE best_cv IS NOT NULL ORDER BY best_cv').all() as Row[]).map(
      (r) => String(r.best_cv),
    );
    return { counts, lastRun: runs.find((r) => r.status === 'done') ?? null, runs, profiles, running };
  } finally {
    db.close();
  }
}
