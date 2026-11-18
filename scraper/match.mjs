import { locate } from './geo.mjs';
// Bepaalt of een vacature bij je CV's past en geeft een score.
//
// Score-opbouw (per CV-profiel, het beste profiel wint):
//   +6   functietitel bevat een rol uit dat CV (bv. "backend developer")
//   +2   per skill in de titel   (x gewicht)
//   +1   per skill in de tekst   (x gewicht, max +6)
//   +3   junior / graduate / starter in de titel (+1.5 als het enkel in de tekst staat)
//   +2   locatie in je voorkeursregio (Gent e.o.)
//   -4   vraagt meer jaren ervaring dan maxYearsExperience
// Wordt weggefilterd: uitgesloten titelwoorden (senior, lead, ...), locaties buiten België
// (tenzij remote), en titels zonder rol- of techmatch.

const norm = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

const reCache = new Map();
function phraseRe(phrase) {
  const p = norm(phrase).trim();
  if (!reCache.has(p)) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]?');
    reCache.set(p, new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'i'));
  }
  return reCache.get(p);
}
const has = (text, phrase) => phraseRe(phrase).test(text);

const JUNIOR = ['junior', 'jr', 'graduate', 'young graduate', 'starter', 'entry level', 'entry-level', 'trainee', 'schoolverlater', 'pas afgestudeerd', 'beginnend', 'debutant'];
const GENERIC_TECH = ['developer', 'engineer', 'ontwikkelaar', 'programmeur', 'programmer', 'analyst', 'analist', 'consultant', 'administrator', 'beheerder', 'ingenieur', 'architect', 'specialist', 'technician', 'technicus'];

function requiredYears(text) {
  const re = /(?<!(?:tot|to|-|–|à|and|en)\s*)(?<!\d)(\d{1,2})\s*\+?\s*(?:(?:-|–|tot|to|à)\s*\d{1,2}\s*)?(?:years?|yrs|jaar|jaren|ans|année?s)\b/gi;
  let max = 0;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (n > 0 && n <= 15) max = Math.max(max, n);
  }
  return max;
}

/**
 * Ligt de job binnen je straal (maxDistanceKm rond settings.home)?
 * near = binnen de straal · remote = volledig thuiswerk · unknown = geen plaats vermeld
 */
export function locationAllowed(job, settings) {
  const loc = locate(job, settings.home, settings.maxDistanceKm);
  const where = job.location || job.companyCity || '?';
  switch (loc.kind) {
    case 'near': return { ok: true, ...loc };
    case 'remote':
      if (!settings.allowRemote) return { ok: false, ...loc, reason: `remote (${where})` };
      return { ok: true, ...loc };
    case 'unknown': return settings.unknownLocation === 'drop' ? { ok: false, ...loc, reason: 'locatie onbekend' } : { ok: true, ...loc };
    case 'far': return { ok: false, ...loc, reason: `${loc.km} km (${where})` };
    default: return { ok: false, ...loc, reason: `buitenland (${where})` };
  }
}

/**
 * Snelle check op enkel titel/bedrijf/locatie, vóór we een (dure) detailpagina ophalen.
 */
export function prefilter(job, profile, settings) {
  const title = norm(`${job.title} ${job.titleHint || ''}`);
  const company = norm(job.company || '');
  const location = norm(job.location || '');
  if (company && settings.excludeCompanies.some((c) => company.includes(norm(c)))) return { ok: false, reason: 'bedrijf uitgesloten' };
  const badWord = settings.excludeTitleWords.find((w) => has(norm(job.title), w.trim()));
  if (badWord) return { ok: false, reason: `titel bevat "${badWord.trim()}"` };
  if (location || job.companyCity) {
    const loc = locationAllowed(job, settings);
    if (!loc.ok) return { ok: false, reason: loc.reason };
  }
  const roleOrTech =
    GENERIC_TECH.some((w) => has(title, w)) ||
    settings.extraRoles.some((r) => has(title, r)) ||
    profile.profiles.some((p) => p.roles.some((r) => has(title, r)) || p.skills.some((s) => s.aliases.some((a) => has(title, a)))) ||
    /\b(it|ict|data|cloud|devops|software|python|backend|systeem|system|netwerk|network|bi)\b/.test(title);
  if (!roleOrTech) return { ok: false, reason: 'geen tech-functie' };
  return { ok: true };
}

/**
 * @returns {{ok:boolean, score:number, bestCv?:string, matched?:string[], reason?:string}}
 */
export function scoreJob(job, profile, settings) {
  const title = norm(job.title);
  const desc = norm(job.description || '').slice(0, 20000);
  const pre = prefilter(job, profile, settings);
  if (!pre.ok) return { ok: false, score: 0, reason: pre.reason };
  if (job.freelance && settings.excludeFreelance !== false) return { ok: false, score: 0, reason: 'freelance' };

  // Locatie: afstand tot je thuisadres
  const loc = locationAllowed(job, settings);
  if (!loc.ok) return { ok: false, score: 0, reason: loc.reason };

  let best = { score: -Infinity };
  for (const p of profile.profiles) {
    let score = 0;
    const matched = [];
    const roles = [...p.roles, ...settings.extraRoles];
    const roleHit = roles.filter((r) => has(title, r)).sort((a, b) => b.length - a.length)[0];
    if (roleHit) { score += 6; matched.push(roleHit); }

    const skills = [...p.skills, ...settings.extraSkills.map((s) => ({ name: s, aliases: [s], weight: 1 }))];
    let titleSkills = 0;
    let descScore = 0;
    for (const s of skills) {
      const inTitle = s.aliases.some((a) => has(title, a));
      const inDesc = !inTitle && s.aliases.some((a) => has(desc, a));
      if (inTitle) { score += 2 * s.weight; titleSkills++; matched.push(s.name); }
      else if (inDesc) { descScore += s.weight; matched.push(s.name); }
    }
    score += Math.min(descScore, 6);

    // Zonder rolmatch moet het minstens een tech-functie met duidelijke skill-overlap zijn.
    if (!roleHit) {
      const techTitle = GENERIC_TECH.some((w) => has(title, w));
      if (!(techTitle && (titleSkills >= 1 || descScore >= 3))) score = -Infinity;
    }
    if (score > best.score) best = { score, bestCv: p.name, matched };
  }
  if (best.score === -Infinity) return { ok: false, score: 0, reason: 'geen rol/skill-match' };

  let score = best.score;
  if (JUNIOR.some((w) => has(title, w))) score += 3;
  else if (JUNIOR.some((w) => has(desc, w))) score += 1.5;
  if (loc.km !== null && loc.km <= 10) score += 2;
  else if (loc.kind === 'near') score += 1;
  if (loc.kind === 'remote') score += 0.5;
  const years = requiredYears(desc);
  if (years > settings.maxYearsExperience) score -= 4;

  score = Math.round(score * 10) / 10;
  return {
    ok: score >= settings.minScore,
    score,
    bestCv: best.bestCv,
    matched: [...new Set(best.matched)],
    km: loc.km,
    locKind: loc.kind,
    reason: score < settings.minScore ? `score ${score} < ${settings.minScore}` : undefined,
  };
}
