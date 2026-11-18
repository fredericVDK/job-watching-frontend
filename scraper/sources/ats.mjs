// Officiële, publieke vacature-API's van de recruitmentsystemen (ATS) die bedrijven gebruiken.
// Dit is betrouwbaarder dan HTML scrapen: de data is gestructureerd en de link gaat
// rechtstreeks naar de sollicitatiepagina.
import { fetchJson, fetchText, htmlToText, decodeEntities } from '../http.mjs';
import { fetchHtmlCompany } from './html.mjs';

const loc = (...parts) => parts.filter(Boolean).join(', ');

export const ATS = {
  async greenhouse({ slug }) {
    const d = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    return d.jobs.map((j) => ({
      url: j.absolute_url,
      title: j.title,
      location: j.location?.name,
      description: htmlToText(decodeEntities(j.content || '')),
      posted_at: j.first_published || j.updated_at,
    }));
  },

  async lever({ slug, region }) {
    const host = region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    const d = await fetchJson(`https://${host}/v0/postings/${slug}?mode=json`);
    return d.map((j) => ({
      url: j.hostedUrl,
      title: j.text,
      location: loc(j.categories?.location, ...(j.categories?.allLocations || [])),
      remote: j.workplaceType === 'remote',
      description: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`)].join('\n'),
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
    }));
  },

  async ashby({ slug }) {
    const d = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    return d.jobs.map((j) => ({
      url: j.jobUrl,
      title: j.title,
      location: loc(j.location, ...(j.secondaryLocations || []).map((s) => s.location)),
      remote: !!j.isRemote,
      description: j.descriptionPlain,
      posted_at: j.publishedAt,
    }));
  },

  async recruitee({ slug, url }) {
    // Ook custom domeinen (bv. careers.teamleader.eu) hebben /api/offers/
    const base = url ? new URL(url).origin : `https://${slug}.recruitee.com`;
    const d = await fetchJson(`${base}/api/offers/`);
    return d.offers.map((j) => ({
      url: j.careers_url,
      title: j.title,
      location: loc(j.location, j.city, j.country),
      remote: !!j.remote,
      description: htmlToText(`${j.description || ''}\n${j.requirements || ''}`),
      posted_at: j.published_at,
    }));
  },

  async workable({ slug }) {
    const d = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`);
    return (d.jobs || []).map((j) => ({
      url: j.url || j.application_url || `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
      title: j.title,
      location: loc(j.city, j.state, j.country),
      remote: !!j.telecommuting,
      description: htmlToText(j.description || ''),
      posted_at: j.published_on || j.created_at,
    }));
  },

  async smartrecruiters({ slug, country = 'be' }) {
    const out = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const c = country ? `&country=${country}` : '';
      const d = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}${c}`);
      for (const j of d.content) {
        out.push({
          url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
          title: j.name,
          location: loc(j.location?.city, j.location?.region, j.location?.country === 'be' ? 'Belgium' : j.location?.country),
          remote: !!j.location?.remote,
          posted_at: j.releasedDate,
          // Beschrijving enkel ophalen voor kandidaten (spaart honderden requests).
          fetchDetail: async () => {
            const det = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${j.id}`);
            const s = det.jobAd?.sections || {};
            return { description: htmlToText([s.jobDescription?.text, s.qualifications?.text].join('\n')) };
          },
        });
      }
      if (offset + 100 >= d.totalFound) break;
    }
    return out;
  },

  async personio({ slug }) {
    let xml;
    for (const tld of ['de', 'com']) {
      try { ({ text: xml } = await fetchText(`https://${slug}.jobs.personio.${tld}/xml`)); break; } catch { /* volgende */ }
    }
    if (!xml) throw new Error(`personio ${slug}: niet gevonden`);
    const tag = (s, t) => decodeEntities((s.match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || '');
    return [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map(([, p]) => ({
      url: `https://${slug}.jobs.personio.de/job/${tag(p, 'id')}`,
      title: tag(p, 'name'),
      location: tag(p, 'office'),
      description: htmlToText([...p.matchAll(/<value>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/value>/g)].map((m) => decodeEntities(m[1])).join('\n')),
      posted_at: tag(p, 'createdAt'),
    }));
  },

  async teamtailor({ url }) {
    // Teamtailor career sites bieden een RSS-feed op /jobs.rss
    const base = url.replace(/\/+$/, '').replace(/\/jobs$/, '');
    let text;
    for (const b of [base, new URL(base).origin]) {
      try { ({ text } = await fetchText(`${b}/jobs.rss`, { retries: 0 })); if (text.includes('<rss')) break; } catch { /* volgende */ }
    }
    if (!text || !text.includes('<rss')) throw new Error(`teamtailor: geen RSS op ${base}`);
    const tag = (s, t) => decodeEntities((s.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || '').trim();
    return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
      url: tag(it, 'link'),
      title: tag(it, 'title'),
      location: [...it.matchAll(/<tt:city>([\s\S]*?)<\/tt:city>/g)].map((m) => m[1]).join(', ') || tag(it, 'tt:locations'),
      remote: /remote/i.test(tag(it, 'remoteStatus') || ''),
      description: htmlToText(decodeEntities(tag(it, 'description'))),
      posted_at: tag(it, 'pubDate') ? new Date(tag(it, 'pubDate')).toISOString() : undefined,
    }));
  },

  async workday({ url }) {
    // url zoals https://tenant.wd3.myworkdayjobs.com/en-US/SiteName
    const u = new URL(url);
    const tenant = u.hostname.split('.')[0];
    const parts = u.pathname.split('/').filter(Boolean);
    const site = parts.find((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
    const api = `${u.origin}/wday/cxs/${tenant}/${site}`;
    const out = [];
    for (let offset = 0; offset < 400; offset += 20) {
      const d = await fetchJson(`${api}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      });
      for (const j of d.jobPostings || []) {
        out.push({
          url: `${u.origin}/${site}${j.externalPath}`,
          title: j.title,
          location: j.locationsText,
          fetchDetail: async () => {
            const det = await fetchJson(`${api}${j.externalPath}`);
            const info = det.jobPostingInfo || {};
            return { description: htmlToText(info.jobDescription || ''), location: info.location || j.locationsText, posted_at: info.startDate };
          },
        });
      }
      if (!d.jobPostings?.length || offset + 20 >= (d.total || 0)) break;
    }
    return out;
  },
};

/** Haalt alle vacatures op voor één bedrijf uit config/companies.json */
export async function fetchCompany(company) {
  if (company.ats?.type === 'html') return fetchHtmlCompany(company);
  const fn = ATS[company.ats?.type];
  if (!fn) return [];
  const jobs = await fn(company.ats);
  return jobs
    .filter((j) => j.url && j.title)
    .map((j) => ({ ...j, company: company.name, source: `company:${company.ats.type}` }));
}
