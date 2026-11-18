// Generieke bron voor bedrijven met een eigen vacaturepagina (geen bekend ATS).
// Neemt alle links die op een vacature lijken van de career-pagina; detailpagina's
// worden enkel opgehaald voor kandidaten die op titel al kunnen matchen.
import { fetchText, htmlToText, decodeEntities } from '../http.mjs';

const JOB_PATH = /\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?(?:job|jobs|vacature|vacatures|vacancy|vacancies|careers?|positions?|openings?|offres?|emplois?|join-us|werken-bij|jobs\/detail)\/(?!(?:about|life|culture|benefits|faq|students?|spontaneous|open-application|career-stories|team|teams|values|locations?|departments?|search|apply|page|category|categories|tag|feed)\b)[a-z0-9][^/?#"]{3,}\/?$/i;

export function extractJobLinks(html, pageUrl) {
  const page = new URL(pageUrl);
  const rootHost = page.hostname.split('.').slice(-2).join('.');
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u;
    try { u = new URL(decodeEntities(m[1]), page); } catch { continue; }
    if (!u.hostname.endsWith(rootHost) || !JOB_PATH.test(u.pathname)) continue;
    if (u.href.replace(/\/$/, '') === page.href.replace(/\/$/, '')) continue;
    const text = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
    const slugWords = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()).replace(/[-_]+/g, ' ').replace(/\b(jid|id)?\s?\d+$/i, '').trim();
    const title = text.length >= 4 && text.length <= 120 && !/^(read more|lees meer|meer info|bekijk|apply|solliciteer|view|details?|more)$/i.test(text) ? text : slugWords;
    const key = u.origin + u.pathname.replace(/\/$/, '');
    if (!out.has(key)) out.set(key, { url: key, title, hint: slugWords });
  }
  return [...out.values()];
}

export function parseJobPage(html) {
  // 1) schema.org JobPosting (JSON-LD) – meest betrouwbaar
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      let d = JSON.parse(m[1].trim());
      const items = [d, ...(Array.isArray(d) ? d : []), ...(d['@graph'] || [])].flat();
      const jp = items.find((x) => x && (x['@type'] === 'JobPosting' || (Array.isArray(x['@type']) && x['@type'].includes('JobPosting'))));
      if (jp) {
        const locs = [jp.jobLocation].flat().filter(Boolean).map((l) => {
          const a = l.address || {};
          return [a.addressLocality, a.addressRegion, typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name].filter(Boolean).join(', ');
        });
        return {
          title: decodeEntities(jp.title || ''),
          description: htmlToText(decodeEntities(jp.description || '')),
          location: locs.join(' | '),
          remote: jp.jobLocationType === 'TELECOMMUTE',
          posted_at: jp.datePosted,
          company: jp.hiringOrganization?.name,
        };
      }
    } catch { /* ongeldige JSON-LD */ }
  }
  // 2) Fallback: og:title / h1 + paginatekst
  const og = (p) => decodeEntities((html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)`, 'i')) || [])[1] || '');
  const h1 = htmlToText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  return { title: h1 || og('title'), description: htmlToText(main).slice(0, 15000) };
}

export async function fetchHtmlCompany(company) {
  const { text, url } = await fetchText(company.ats.url, { timeout: 30000 });
  return extractJobLinks(text, url).map((l) => ({
    url: l.url,
    title: l.title,
    titleHint: l.hint,
    company: company.name,
    belgian: true, // bedrijven in de lijst zitten in België; detailpagina kan dit overschrijven
    source: 'company:html',
    fetchDetail: async () => {
      const { text: page } = await fetchText(l.url, { timeout: 30000 });
      const d = parseJobPage(page);
      const out = { description: d.description };
      if (d.title && d.title.length < 150) out.title = d.title;
      if (d.location) { out.location = d.location; out.belgian = false; }
      if (d.remote) out.remote = true;
      if (d.posted_at) out.posted_at = d.posted_at;
      return out;
    },
  }));
}
