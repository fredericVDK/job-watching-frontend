// Vacaturesites / aggregators.
import { fetchJson, fetchText, htmlToText, decodeEntities } from '../http.mjs';

/** ictjob.be – grootste Belgische IT-jobsite. Publieke sitemap + detailpagina's. */
export async function ictjob() {
  const { text } = await fetchText('https://www.ictjob.be/nl/jobs-sitemap.xml', { timeout: 60000 });
  const urls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  return urls.map((url) => {
    const slug = url.split('/').slice(-2, -1)[0] || '';
    return {
      url,
      title: slug.replace(/-/g, ' '),
      source: 'ictjob',
      belgian: true,
      fetchDetail: async () => {
        const { text: h } = await fetchText(url, { timeout: 25000, retries: 1 });
        const grab = (re) => decodeEntities(((h.match(re) || [])[1] || '').replace(/\s+/g, ' ').trim());
        let company = grab(/class="company-image"[^>]*title="([^"]*)"/);
        let title = grab(/id="job-title"[^>]*>([\s\S]*?)<\/h1>/) || grab(/property="og:title"\s+content="([^"]*)"/);
        if (company && title.toLowerCase().startsWith(company.toLowerCase() + ' - ')) title = title.slice(company.length + 3);
        else if (!company && title.includes(' - ')) [company, title] = [title.slice(0, title.indexOf(' - ')), title.slice(title.indexOf(' - ') + 3)];
        const location = grab(/id="job-location"[^>]*>([\s\S]*?)</);
        const arrangement = grab(/id="work-arrangement"[^>]*>([\s\S]*?)</);
        const contract = grab(/itemprop="employmentType"[^>]*>\s*<span[^>]*>([\s\S]*?)</);
        const req = grab(/id="job-requirements"[^>]*>([\s\S]*?)</);
        const start = h.indexOf('id="html-content"');
        const end = h.indexOf('itemprop="hiringOrganization"', start);
        const body = start > 0 ? htmlToText('<div ' + h.slice(start, end > start ? end : start + 40000)) : grab(/property="og:description"\s+content="([^"]*)"/);
        return {
          title,
          company,
          location: [location, arrangement].filter(Boolean).join(' · '),
          remote: /remote|thuiswerk/i.test(arrangement),
          freelance: /freelance/i.test(contract),
          description: `${req ? `Vereist: ${req}\n` : ''}${contract ? `Contract: ${contract}\n` : ''}${body}`,
        };
      },
    };
  });
}

/** Adzuna – aggregator met Belgische vacatures (gratis API-key nodig, zie README). */
export async function adzuna({ profile, settings }) {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return { skipped: 'geen ADZUNA_APP_ID / ADZUNA_APP_KEY in .env' };
  // Zoek op de belangrijkste rol van elk CV + een paar algemene junior-zoektermen.
  const queries = new Set(['junior developer', 'junior engineer']);
  for (const p of profile.profiles) p.roles.slice(0, 3).forEach((r) => queries.add(r));
  settings.extraRoles.slice(0, 3).forEach((r) => queries.add(r));
  const out = [];
  for (const q of queries) {
    const url = `https://api.adzuna.com/v1/api/jobs/be/search/1?app_id=${id}&app_key=${key}&results_per_page=50&max_days_old=7&what_phrase=${encodeURIComponent(q)}&content-type=application/json`;
    const d = await fetchJson(url);
    for (const j of d.results || []) {
      out.push({
        url: j.redirect_url,
        title: htmlToText(j.title),
        company: j.company?.display_name,
        location: j.location?.display_name,
        description: htmlToText(j.description),
        posted_at: j.created,
        belgian: true,
        source: 'adzuna',
      });
    }
  }
  return out;
}

/** Remotive – remote jobs (enkel als Europa/wereldwijd toegelaten is). */
export async function remotive() {
  const out = [];
  for (const cat of ['software-dev', 'devops', 'data']) {
    const d = await fetchJson(`https://remotive.com/api/remote-jobs?category=${cat}`);
    for (const j of d.jobs || []) {
      out.push({
        url: j.url,
        title: j.title,
        company: j.company_name,
        location: `Remote (${j.candidate_required_location || 'onbekend'})`,
        remote: true,
        description: htmlToText(j.description),
        posted_at: j.publication_date,
        source: 'remotive',
      });
    }
  }
  return out;
}

/** Arbeitnow – Europese jobs (vooral DE), houdt enkel Belgische/remote-EU over na filtering. */
export async function arbeitnow() {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const d = await fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    for (const j of d.data || []) {
      out.push({
        url: j.url,
        title: j.title,
        company: j.company_name,
        location: j.location + (j.remote ? ' (remote)' : ''),
        remote: !!j.remote,
        description: htmlToText(j.description),
        posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
        source: 'arbeitnow',
      });
    }
    if (!d.links?.next) break;
  }
  return out;
}
