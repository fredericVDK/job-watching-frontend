// `npm run discover` – zoekt voor elk bedrijf in config/companies.json uit welk
// recruitmentsysteem (ATS) het gebruikt, en slaat dat op. Daarna kan de dagelijkse
// scraper rechtstreeks hun vacature-API aanspreken.
//
// Nieuw bedrijf toevoegen? Zet { "name": "...", "website": "https://..." } in
// config/companies.json en voer `npm run discover` uit.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchText, pool, sleep } from './http.mjs';
import { ATS } from './sources/ats.mjs';
import { extractJobLinks } from './sources/html.mjs';
import { loadCompanies, ROOT } from './settings.mjs';

const PATTERNS = [
  { type: 'greenhouse', re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { type: 'greenhouse', re: /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i },
  { type: 'lever', re: /jobs\.(eu\.)?lever\.co\/([a-z0-9_.-]+)/i, lever: true },
  { type: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i },
  { type: 'recruitee', re: /([a-z0-9-]+)\.recruitee\.com/i },
  { type: 'workable', re: /apply\.workable\.com\/([a-z0-9_-]+)/i },
  { type: 'workable', re: /([a-z0-9-]+)\.workable\.com/i },
  { type: 'personio', re: /([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i },
  { type: 'smartrecruiters', re: /(?:jobs|careers)\.smartrecruiters\.com\/(?:[a-z]{2}\/)?([a-z0-9_-]+)/i },
  { type: 'teamtailor', re: /https?:\/\/([a-z0-9-]+\.teamtailor\.com)/i, url: true },
  { type: 'workday', re: /https?:\/\/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[A-Za-z0-9_-]+/, full: true },
];
const IGNORE_SLUGS = new Set(['www', 'api', 'app', 'jobs', 'careers', 'embed', 'static', 'assets', 'cdn', 'widget', 'v1', 'js']);

const CAREER_PATHS = ['', '/careers', '/jobs', '/en/careers', '/nl/careers', '/vacatures', '/nl/vacatures', '/werken-bij', '/join-us', '/careers/open-positions', '/about/careers', '/company/careers', '/jobs/', '/en/jobs', '/nl/jobs'];

function findInHtml(html) {
  for (const p of PATTERNS) {
    const m = html.match(p.re);
    if (!m) continue;
    if (p.full) return { type: p.type, url: m[0] };
    if (p.url) return { type: p.type, url: `https://${m[1]}` };
    if (p.lever) return { type: 'lever', slug: m[2], region: m[1] ? 'eu' : undefined };
    if (!IGNORE_SLUGS.has(m[1].toLowerCase())) return { type: p.type, slug: decodeURIComponent(m[1]) };
  }
  // Custom-domein Recruitee (bv. careers.teamleader.eu)
  if (/recruiteecdn\.com/i.test(html)) return { type: 'recruitee-custom' };
  // Custom-domein Teamtailor (bv. careers.bedrijf.be)
  if (/teamtailor/i.test(html) && /jobs\.rss|teamtailor-cdn|tt-career/i.test(html)) return { type: 'teamtailor-custom' };
  return null;
}

function slugGuesses(c) {
  const host = new URL(c.website).hostname.replace(/^www\./, '').split('.')[0];
  const n = c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return [...new Set([host, n.replace(/[^a-z0-9]/g, ''), n.replace(/[^a-z0-9]+/g, '-'), n.split(/\s+/)[0].replace(/[^a-z0-9]/g, '')])].filter((s) => s.length > 1);
}

async function verify(ats) {
  try {
    const jobs = await ATS[ats.type](ats);
    return Array.isArray(jobs) ? jobs.length : -1;
  } catch {
    return -1;
  }
}

async function tryFound(found, pageUrl) {
  if (found.type === 'recruitee-custom') {
    const ats = { type: 'recruitee', url: new URL(pageUrl).origin };
    const n = await verify(ats);
    return n >= 0 ? { ats, jobs: n } : null;
  }
  if (found.type === 'teamtailor-custom') {
    const ats = { type: 'teamtailor', url: pageUrl.replace(/[?#].*$/, '') };
    const n = await verify(ats);
    return n >= 0 ? { ats, jobs: n } : null;
  }
  const n = await verify(found);
  if (n >= 0) return { ats: found, jobs: n };
  if (found.type === 'lever' && !found.region) {
    const eu = { ...found, region: 'eu' };
    const m = await verify(eu);
    if (m >= 0) return { ats: eu, jobs: m };
  }
  return null;
}

const CAREER_LINK = /href=["']([^"']*(?:career|carriere|jobs|vacature|werken|join-us|joinus|work-with-us|werkenbij)[^"']*)["']/gi;

async function discoverOne(c) {
  // 1) Zoek ATS-links op de website, de career-pagina's en links daarnaartoe
  const base = c.website.replace(/\/+$/, '');
  const queue = c.careersUrl ? [c.careersUrl] : CAREER_PATHS.map((p) => base + p);
  const rootHost = new URL(base).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
  const tried = new Set();
  let bestHtml = null;
  for (let i = 0; i < queue.length && i < 24; i++) {
    const u = queue[i];
    let text, finalUrl;
    try {
      ({ text, url: finalUrl } = await fetchText(u, { timeout: 20000, retries: 0 }));
    } catch { continue; }
    if (tried.has(finalUrl)) continue;
    tried.add(finalUrl);
    const found = findInHtml(finalUrl + ' ' + text);
    if (found) {
      const r = await tryFound(found, finalUrl);
      if (r) return { ...r, via: finalUrl };
    }
    // Eigen vacaturepagina? Onthoud de pagina met de meeste vacature-links.
    const links = extractJobLinks(text, finalUrl);
    if (links.length >= 2 && (!bestHtml || links.length > bestHtml.n)) bestHtml = { url: finalUrl, n: links.length };
    // Volg career-links (ook naar subdomeinen zoals careers.bedrijf.be)
    for (const m of text.matchAll(CAREER_LINK)) {
      try {
        const l = new URL(m[1].replace(/&amp;/g, '&'), finalUrl);
        const h = l.hostname;
        if ((h.endsWith(rootHost) || PATTERNS.some((p) => p.re.test(l.href))) && !queue.includes(l.href) && queue.length < 40) queue.push(l.href);
      } catch { /* ongeldige link */ }
    }
    await sleep(150);
  }
  // 2) Gok de slug rechtstreeks bij de populairste ATS'en
  for (const slug of slugGuesses(c)) {
    for (const ats of [
      { type: 'greenhouse', slug }, { type: 'lever', slug }, { type: 'lever', slug, region: 'eu' }, { type: 'ashby', slug },
      { type: 'recruitee', slug }, { type: 'personio', slug }, { type: 'teamtailor', url: `https://${slug}.teamtailor.com` },
    ]) {
      const n = await verify(ats);
      if (n > 0) return { ats, jobs: n, via: 'slug-gok' };
    }
    try {
      const { text } = await fetchText(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`, { retries: 0 });
      const n = JSON.parse(text).totalFound;
      if (n > 0) return { ats: { type: 'smartrecruiters', slug }, jobs: n, via: 'slug-gok' };
    } catch { /* niets */ }
  }
  if (bestHtml) return { ats: { type: 'html', url: bestHtml.url }, jobs: bestHtml.n, via: bestHtml.url };
  return null;
}

const all = process.argv.includes('--all');
const companies = loadCompanies();
const retry = process.argv.includes('--retry');
const todo = companies.filter((c) => all || !c.ats || (retry && c.noAts));
console.log(`ATS zoeken voor ${todo.length} bedrijven (gebruik --all om alles opnieuw te checken)...\n`);

await pool(todo, 4, async (c) => {
  const r = await discoverOne(c).catch(() => null);
  c.checkedAt = new Date().toISOString().slice(0, 10);
  if (r) {
    c.ats = r.ats;
    delete c.noAts;
    console.log(`✔ ${c.name.padEnd(28)} ${r.ats.type.padEnd(16)} ${String(r.jobs).padStart(4)} jobs`);
  } else {
    c.noAts = true;
    console.log(`✘ ${c.name.padEnd(28)} geen ondersteund ATS gevonden`);
  }
});

writeFileSync(resolve(ROOT, 'config', 'companies.json'), JSON.stringify({ companies }, null, 2));
const ok = companies.filter((c) => c.ats).length;
console.log(`\n${ok}/${companies.length} bedrijven worden dagelijks gecheckt. Opgeslagen in config/companies.json`);
