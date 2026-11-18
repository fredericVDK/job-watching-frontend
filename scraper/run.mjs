// `npm run scrape` – de dagelijkse run.
//  1. werkt (indien nodig) de keywords bij uit je CV's
//  2. haalt vacatures op uit alle bronnen
//  3. scoort ze tegen je CV-profielen
//  4. bewaart enkel nieuwe, passende jobs in data/jobwatcher.db
//
// Opties:  --only=ictjob,companies   enkel bepaalde bronnen
//          --dry                     niets wegschrijven (testen)
//          --rescore                 ook eerder afgewezen URL's opnieuw bekijken
import { appendFileSync, mkdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, normalizeKey, DB_PATH } from './db.mjs';
import { loadSettings, loadProfile, loadCompanies, loadEnv, ROOT } from './settings.mjs';
import { buildProfile } from './keywords.mjs';
import { scoreJob, prefilter, locationAllowed } from './match.mjs';
import { loadApplications, findApplication } from './applications.mjs';
import { fetchCompany } from './sources/ats.mjs';
import { ictjob, adzuna, remotive, arbeitnow } from './sources/boards.mjs';
import { pool, sleep } from './http.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const DRY = !!args.dry;

mkdirSync(resolve(ROOT, 'logs'), { recursive: true });
const LOG = resolve(ROOT, 'logs', 'scraper.log');
const log = (...m) => {
  const line = `[${new Date().toLocaleString('nl-BE')}] ${m.join(' ')}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* log is niet kritisch */ }
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`JobWatcher heeft Node.js 22.13 of nieuwer nodig (jij hebt ${process.versions.node}). Download de LTS-versie op https://nodejs.org`);
  process.exit(1);
}

loadEnv();
const settings = loadSettings();

// 1. Keywords bijwerken als een CV nieuwer is dan profile.json
let profile;
try {
  profile = loadProfile();
  const changed = profile.profiles.some((p) => existsSync(p.cv) && statSync(p.cv).mtime > new Date(profile.generatedAt));
  if (changed) {
    log('CV aangepast → keywords opnieuw opbouwen');
    profile = buildProfile();
  }
} catch {
  log('Keywords opbouwen uit CV\'s…');
  profile = buildProfile();
}
log(`Profielen: ${profile.profiles.map((p) => p.name).join(', ')}`);

// 2. Bronnen
const SOURCES = {
  companies: async () => {
    const companies = loadCompanies().filter((c) => c.ats && !c.disabled);
    const errors = [];
    const lists = await pool(companies, 6, async (c) => {
      try { return (await fetchCompany(c)).map((j) => ({ ...j, companyCity: c.city, belgian: true })); }
      catch (e) { errors.push(`${c.name}: ${e.message}`); return []; }
    });
    if (errors.length) log(`  ⚠ ${errors.length} bedrijven gaven een fout: ${errors.slice(0, 5).join(' | ')}${errors.length > 5 ? ' …' : ''}`);
    return lists.flat();
  },
  ictjob,
  adzuna: () => adzuna({ profile, settings }),
  remotive,
  arbeitnow,
};
const only = args.only ? String(args.only).split(',') : null;
const enabled = Object.keys(SOURCES).filter((k) => (only ? only.includes(k) : settings.sources[k] !== false));

// Je sollicitatie-overzicht (Google Sheet / Excel)
let apps = [];
try {
  const r = await loadApplications(settings);
  apps = r.apps;
  log(r.skipped ? `– sollicitaties: overgeslagen (${r.skipped})` : `✔ sollicitaties: ${apps.length} rijen ingelezen uit je sheet`);
} catch (e) {
  log(`⚠ sollicitaties: ${e.message}`);
}
const appNote = (a) => `In je sheet (${a.tab}): ${a.company} – ${a.title || a.url}${a.date ? `, ${a.date}` : ''}`;

const db = DRY ? null : openDb();
const now = new Date().toISOString();
const runId = DRY ? 0 : Number(db.prepare('INSERT INTO runs (started_at) VALUES (?)').run(now).lastInsertRowid);

const q = DRY ? null : {
  byUrl: db.prepare('SELECT id FROM jobs WHERE url = ?'),
  byKey: db.prepare('SELECT id FROM jobs WHERE dedupe_key = ?'),
  touch: db.prepare('UPDATE jobs SET last_seen_at = ? WHERE id = ?'),
  seen: db.prepare('SELECT 1 FROM seen_urls WHERE url = ?'),
  markSeen: db.prepare('INSERT OR IGNORE INTO seen_urls (url, first_seen_at) VALUES (?, ?)'),
  insert: db.prepare(`INSERT INTO jobs (url, dedupe_key, source, company, title, location, remote, description, posted_at,
      first_seen_at, last_seen_at, first_run_id, score, best_cv, matched, distance_km, loc_kind, status, status_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
};

// "Mechelen, Vlaams Gewest, Belgium, Mechelen, Belgium" -> "Mechelen, Vlaams Gewest, Belgium"
function cleanLocation(loc) {
  if (!loc) return null;
  const seen = new Set();
  return loc.split(/\s*[,|]\s*/).filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase())).join(', ');
}

const stats = {};
let totalFound = 0;
let matchedCount = 0;
let newCount = 0;
const newJobs = [];

for (const name of enabled) {
  const t0 = Date.now();
  const st = (stats[name] = { found: 0, new: 0, detail: 0 });
  let raw;
  try {
    raw = await SOURCES[name]();
  } catch (e) {
    st.error = e.message;
    log(`✘ ${name}: ${e.message}`);
    continue;
  }
  if (raw && raw.skipped) {
    st.skipped = raw.skipped;
    log(`– ${name}: overgeslagen (${raw.skipped})`);
    continue;
  }
  st.found = raw.length;
  totalFound += raw.length;

  // Al gekend? -> enkel last_seen bijwerken
  const candidates = [];
  for (const job of raw) {
    job.source ||= name;
    if (!DRY) {
      const existing = q.byUrl.get(job.url) || (job.company && q.byKey.get(normalizeKey(job.company, job.title)));
      if (existing) { q.touch.run(now, existing.id); continue; }
      if (!args.rescore && job.fetchDetail && q.seen.get(job.url)) continue;
    }
    if (!prefilter(job, profile, settings).ok) {
      if (!DRY && job.fetchDetail) q.markSeen.run(job.url, now);
      continue;
    }
    candidates.push(job);
  }

  // Detailpagina's ophalen (enkel voor kandidaten), beleefd: max 4 tegelijk.
  // Tijdslimiet per bron: wat niet lukt, wordt bij de volgende run opgepikt.
  const deadline = t0 + (settings.maxMinutesPerSource ?? 10) * 60_000;
  let budget = settings.maxDetailsPerSource ?? 300;
  await pool(candidates, 4, async (job) => {
    if (!job.fetchDetail) return;
    if (Date.now() > deadline || budget-- <= 0) { job.detailError = 'uitgesteld'; st.postponed = (st.postponed || 0) + 1; return; }
    try {
      Object.assign(job, await job.fetchDetail());
      st.detail++;
    } catch (e) {
      job.detailError = e.message;
    }
    await sleep(250);
  });

  for (const job of candidates) {
    if (job.detailError) continue; // volgende run opnieuw proberen
    const r = scoreJob(job, profile, settings);
    if (!r.ok) {
      if (!DRY && job.fetchDetail) q.markSeen.run(job.url, now);
      continue;
    }
    matchedCount++;
    const key = normalizeKey(job.company, job.title);
    if (!DRY) {
      if (q.byUrl.get(job.url) || q.byKey.get(key)) continue; // dubbel binnen dezelfde run
      const app = findApplication(job, apps);
      q.insert.run(
        job.url, key, job.source, job.company || null, job.title, cleanLocation(job.location), job.remote ? 1 : 0,
        (job.description || '').slice(0, 20000), job.posted_at || null, now, now, runId, r.score, r.bestCv, JSON.stringify(r.matched),
        r.km, r.locKind, app ? app.mark : 'new', app ? now : null, app ? appNote(app) : null,
      );
      q.markSeen.run(job.url, now);
      if (app) { st.inSheet = (st.inSheet || 0) + 1; continue; } // al gesolliciteerd/afgewezen -> niet als nieuw tellen
    }
    st.new++;
    newCount++;
    newJobs.push({ ...job, ...r });
  }
  log(`✔ ${name.padEnd(10)} ${String(st.found).padStart(5)} gevonden, ${String(st.detail).padStart(4)} details, ${String(st.new).padStart(3)} nieuw${st.inSheet ? ` (+${st.inSheet} al in je sheet)` : ''}  (${((Date.now() - t0) / 1000).toFixed(0)}s)${st.postponed ? `  – ${st.postponed} uitgesteld naar volgende run` : ''}`);
}

// Onderhoud: bestaande jobs opnieuw toetsen aan je straal en je sollicitatie-sheet
// (zo werkt een aangepaste maxDistanceKm of een nieuwe rij in je sheet meteen voor alle jobs).
if (!DRY) {
  const cityOf = Object.fromEntries(loadCompanies().filter((c) => c.city).map((c) => [c.name, c.city]));
  const upd = db.prepare('UPDATE jobs SET distance_km = ?, loc_kind = ?, out_of_range = ? WHERE id = ?');
  const mark = db.prepare('UPDATE jobs SET status = ?, status_at = ?, note = ? WHERE id = ?');
  let outCount = 0, sheetCount = 0;
  for (const j of db.prepare('SELECT id, url, source, company, title, location, remote, status FROM jobs').all()) {
    const loc = locationAllowed({
      location: j.location, remote: !!j.remote, companyCity: cityOf[j.company],
      belgian: !['remotive', 'arbeitnow'].includes(j.source),
    }, settings);
    upd.run(loc.km ?? null, loc.kind, loc.ok ? 0 : 1, j.id);
    if (!loc.ok) outCount++;
    if (['new', 'seen', 'saved'].includes(j.status)) {
      const a = findApplication(j, apps);
      if (a && a.mark !== j.status && !(a.mark === 'saved' && j.status === 'saved')) {
        mark.run(a.mark, now, appNote(a), j.id);
        sheetCount++;
      }
    }
  }
  log(`Onderhoud: ${outCount} jobs buiten ${settings.maxDistanceKm} km verborgen, ${sheetCount} jobs bijgewerkt vanuit je sollicitatie-sheet`);
}

if (!DRY) {
  db.prepare('UPDATE runs SET finished_at = ?, total_found = ?, matched = ?, new_jobs = ?, sources = ?, status = ? WHERE id = ?')
    .run(new Date().toISOString(), totalFound, matchedCount, newCount, JSON.stringify(stats), 'done', runId);
  db.close();
}

newJobs.sort((a, b) => b.score - a.score);
log(`Klaar: ${totalFound} vacatures bekeken, ${newCount} nieuwe matches${DRY ? ' (dry run, niets opgeslagen)' : ` → ${DB_PATH}`}`);
for (const j of newJobs.slice(0, 15)) log(`   ${String(j.score).padStart(5)}  [${j.bestCv}] ${j.title} — ${j.company || '?'} (${j.km != null ? `${j.km} km` : j.locKind})`);
writeFileSync(resolve(ROOT, 'logs', 'last-run.json'), JSON.stringify({ at: now, totalFound, newCount, stats }, null, 2));
