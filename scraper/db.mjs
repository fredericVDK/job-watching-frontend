// SQLite-laag voor de scraper. Gebruikt de ingebouwde `node:sqlite` module
// (Node 22.13+), dus geen native npm-packages nodig.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.JOBWATCHER_DB || resolve(ROOT, 'data', 'jobwatcher.db');

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      total_found   INTEGER DEFAULT 0,
      matched       INTEGER DEFAULT 0,
      new_jobs      INTEGER DEFAULT 0,
      sources       TEXT,           -- JSON: per bron aantallen / fouten
      status        TEXT DEFAULT 'running'
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      url           TEXT NOT NULL UNIQUE,
      dedupe_key    TEXT NOT NULL,
      source        TEXT NOT NULL,
      company       TEXT,
      title         TEXT NOT NULL,
      location      TEXT,
      remote        INTEGER DEFAULT 0,
      description   TEXT,
      posted_at     TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      first_run_id  INTEGER,
      score         REAL DEFAULT 0,
      best_cv       TEXT,           -- welk CV-profiel het best past
      matched       TEXT,           -- JSON-lijst van gematchte keywords
      status        TEXT NOT NULL DEFAULT 'new', -- new | seen | saved | applied | hidden
      status_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_jobs_run ON jobs(first_run_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

    -- Elke URL die ooit bekeken werd (ook niet-matchende), zodat we
    -- detailpagina's niet elke dag opnieuw hoeven op te halen.
    CREATE TABLE IF NOT EXISTS seen_urls (
      url           TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL
    );
  `);
  return db;
}

export function normalizeKey(company, title) {
  const n = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\(m\/v\/x\)|\(m\/f\/x\)|\(m\/v\)|\(h\/f\)|m\/v\/x|m\/f\/d/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${n(company)}|${n(title)}`;
}
