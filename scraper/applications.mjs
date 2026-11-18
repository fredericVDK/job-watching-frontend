// Leest je sollicitatie-overzicht (Google Sheet of lokaal .xlsx/.csv) en herkent welke
// vacatures je al gesolliciteerd of afgewezen hebt, zodat JobWatcher ze niet meer als nieuw toont.
//
// Drie manieren om de sheet te lezen (zie README):
//   1. Service account (privé, aanbevolen): config/google-service-account.json
//   2. Gedeelde link ("iedereen met de link kan bekijken"): werkt zonder key
//   3. Lokaal bestand: "file": "C:/pad/naar/Sollicitaties.xlsx" of .csv
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { resolve } from 'node:path';
import { fetchText, fetchJson } from './http.mjs';
import { readXlsx } from './docx.mjs';
import { ROOT } from './settings.mjs';

// ---------- inlezen ----------

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function googleToken(keyFile) {
  const key = JSON.parse(readFileSync(keyFile, 'utf8'));
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  return res.access_token;
}

/** @returns {Promise<{tab:string, rows:string[][]}[]>} */
async function loadTabs(cfg) {
  const tabs = cfg.tabs?.length ? cfg.tabs : ['Gesolliciteerd', 'Te solliciteren'];

  if (cfg.file) {
    const path = resolve(ROOT, cfg.file);
    if (/\.csv$/i.test(path)) return [{ tab: 'Gesolliciteerd', rows: parseCsv(readFileSync(path, 'utf8')) }];
    const sheets = readXlsx(path);
    return sheets.filter((s) => !cfg.tabs?.length || tabs.includes(s.name)).map((s) => ({ tab: s.name, rows: s.rows }));
  }

  if (!cfg.sheetId) return [];
  const keyFile = resolve(ROOT, cfg.serviceAccountKeyFile || 'config/google-service-account.json');
  if (existsSync(keyFile)) {
    const token = await googleToken(keyFile);
    const out = [];
    for (const tab of tabs) {
      const d = await fetchJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(tab)}?majorDimension=ROWS`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      out.push({ tab, rows: d.values || [] });
    }
    return out;
  }

  // Zonder key: werkt enkel als de sheet gedeeld is met "iedereen met de link".
  const PRIVATE = 'je Google Sheet is privé en er is geen service-account-key (config/google-service-account.json). Zie README → Sollicitaties-sheet.';
  const out = [];
  for (const tab of tabs) {
    let text;
    try {
      ({ text } = await fetchText(
        `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`,
        { retries: 0 },
      ));
    } catch (e) {
      if ([401, 403].includes(e.status)) throw new Error(PRIVATE);
      throw e;
    }
    if (/^\s*<!doctype html|<html/i.test(text)) throw new Error(PRIVATE);
    out.push({ tab, rows: parseCsv(text) });
  }
  return out;
}

// ---------- normaliseren & matchen ----------

const base = (s = '') => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function normCompany(s) {
  return base(s)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(nv|bv|bvba|srl|sa|sprl|vzw|cv|group|groep|belgium|belgie|benelux|it|ict|consultancy|consulting|digital|by .*)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function normTitle(s) {
  return base(s)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(m|v|x|f|h|d)\s*\/\s*(m|v|x|f|h|d)(\s*\/\s*(m|v|x|f|h|d))?\b/g, ' ')
    .replace(/engen+e+r|enginee?\b|enigneer/g, 'engineer')
    .replace(/ontwik+elaar/g, 'ontwikkelaar')
    .replace(/dev[\s-]?ops/g, 'devops')
    .replace(/back[\s-]?end/g, 'backend')
    .replace(/full[\s-]?stack/g, 'fullstack')
    .replace(/front[\s-]?end/g, 'frontend')
    .replace(/&nbsp;?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s) {
  const g = new Map();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const k = t.slice(i, i + 2);
    g.set(k, (g.get(k) || 0) + 1);
  }
  return g;
}
/** Dice-coëfficiënt (0..1): robuust tegen tikfouten zoals "Engeneer" of "Kwerry". */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [k, n] of A) { inter += Math.min(n, B.get(k) || 0); total += n; }
  for (const n of B.values()) total += n;
  return (2 * inter) / total;
}

// Algemene woorden die niets zeggen over wélke functie het is.
const GENERIC = new Set(['engineer', 'developer', 'ontwikkelaar', 'software', 'junior', 'medior', 'senior', 'jr', 'sr', 'and', 'en', 'the', 'of', 'a', 'm', 'v', 'x', 'f', 'h', 'd', 'nl', 'fr', 'new', 'nieuw']);
const sigTokens = (t) => t.split(' ').filter((w) => w && !GENERIC.has(w));

/** Zelfde functie? Onderscheidende woorden moeten overeenkomen (tikfouten toegelaten). */
export function sameTitle(a, b) {
  if (!a || !b) return 0;
  const full = similarity(a, b);
  if (full >= 0.92) return full;
  const A = sigTokens(a), B = sigTokens(b);
  const tokMatch = (x, Y) => Y.some((y) => x === y || (x.length > 3 && similarity(x, y) >= 0.8));
  if (!A.length && !B.length) return full >= 0.8 ? full : 0;
  if (A.length && B.length && A.every((x) => tokMatch(x, B)) && B.every((y) => tokMatch(y, A))) return Math.max(full, 0.8);
  return 0;
}

const normUrl = (u = '') => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

function headerIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map((c) => base(String(c || '')).trim());
    const col = (...names) => h.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
    const company = col('bedrijf', 'company', 'werkgever', 'firma');
    const title = col('functie', 'job', 'titel', 'title', 'rol', 'positie');
    const vacature = col('vacature', 'link', 'url');
    if (company >= 0 && (title >= 0 || vacature >= 0)) {
      return { row: i, company, title: title >= 0 ? title : vacature, url: vacature, status: col('status', 'antwoord'), date: col('datum', 'toegevoegd', 'date') };
    }
  }
  return null;
}

/** Zet de tabbladen om naar een lijst sollicitaties. */
export function toApplications(tabs) {
  const apps = [];
  for (const { tab, rows } of tabs) {
    const h = headerIndex(rows);
    if (!h) continue;
    const todoTab = /te solliciteren|todo|to apply/i.test(tab);
    for (const r of rows.slice(h.row + 1)) {
      const company = String(r[h.company] || '').trim();
      const rawTitle = String(r[h.title] || '').trim();
      const urlCell = String((h.url >= 0 && r[h.url]) || '');
      const url = /^https?:\/\//i.test(urlCell.trim()) ? urlCell.trim() : '';
      const title = /^https?:\/\//i.test(rawTitle) ? '' : rawTitle;
      if (!company && !url) continue;
      if (/spontan/i.test(title)) continue; // spontane sollicitatie: geen specifieke vacature
      const status = base(String((h.status >= 0 && r[h.status]) || ''));
      let mark;
      if (!todoTab) mark = 'applied';
      else if (/niet solliciteren|niet interessant|nee|skip/.test(status)) mark = 'hidden';
      else if (/gesolliciteerd|applied|verstuurd/.test(status)) mark = 'applied';
      else mark = 'saved';
      apps.push({
        tab, company, title, url, mark,
        date: String((h.date >= 0 && r[h.date]) || '').trim(),
        nCompany: normCompany(company), nTitle: normTitle(title), nUrl: normUrl(url),
      });
    }
  }
  return apps;
}

/** Zoekt of een job overeenkomt met een rij uit je sheet. */
export function findApplication(job, apps) {
  const u = normUrl(job.url);
  const c = normCompany(job.company || '');
  const t = normTitle(job.title || '');
  let best = null;
  for (const a of apps) {
    if (a.nUrl && a.nUrl === u) return a;
    if (!c || !a.nCompany || !a.nTitle) continue;
    const cs = a.nCompany === c || (c.length > 3 && a.nCompany.length > 3 && (c.includes(a.nCompany) || a.nCompany.includes(c))) ? 1 : similarity(a.nCompany, c);
    if (cs < 0.75) continue;
    const ts = sameTitle(a.nTitle, t);
    if (ts > 0 && (!best || ts > best.ts)) best = { ...a, ts };
  }
  return best;
}

export async function loadApplications(settings) {
  const cfg = settings.applications || {};
  if (!cfg.sheetId && !cfg.file) return { apps: [], skipped: 'geen sollicitatie-sheet ingesteld' };
  const tabs = await loadTabs(cfg);
  return { apps: toApplications(tabs) };
}
