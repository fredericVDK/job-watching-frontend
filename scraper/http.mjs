// Kleine HTTP-helpers: timeouts, retries en een nette User-Agent.
const UA =
  process.env.JOBWATCHER_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 JobWatcher/2.0';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { timeout = 30000, retries = 2, headers = {}, method = 'GET', body } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8', ...headers },
      });
      const text = await res.text();
      if (res.status === 404) {
        const e = new Error(`404 ${url}`);
        e.status = 404;
        throw e;
      }
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status} ${url}`);
        e.status = res.status;
        throw e;
      }
      return { text, url: res.url, status: res.status };
    } catch (err) {
      lastErr = err;
      if (err.status && err.status < 500 && err.status !== 429) break; // geen zin om te herhalen
      if (attempt < retries) await sleep(1000 * (attempt + 1) * (err.status === 429 ? 5 : 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const { text } = await fetchText(url, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers || {}) },
  });
  return JSON.parse(text);
}

// Voert async taken uit met een maximum aantal tegelijk.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s = '') {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, e) => (e.toLowerCase() in ENTITIES ? ENTITIES[e.toLowerCase()] : m));
}

export function htmlToText(html = '') {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
