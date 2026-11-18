// Leest je CV's (.docx) en maakt per CV een zoekprofiel:
//   - de functietitel ("Junior Backend Developer") -> rolzoektermen
//   - de SKILLS-sectie -> skill-keywords (met synoniemen)
// Resultaat: config/profile.json (wordt bij elke run overschreven, niet zelf aanpassen;
// eigen aanpassingen horen in config/settings.json).
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docxToText } from './docx.mjs';
import { loadSettings, ROOT } from './settings.mjs';

// Welke zoektermen horen bij welke soort functietitel.
const ROLE_SYNONYMS = {
  backend: ['backend developer', 'backend engineer', 'back-end developer', 'back-end engineer', 'api developer', 'node.js developer', 'nodejs developer', 'software developer', 'software engineer', 'web developer', 'full stack developer', 'full-stack developer', 'fullstack developer', 'softwareontwikkelaar', 'ontwikkelaar'],
  python: ['python developer', 'python engineer', 'python ontwikkelaar', 'automation engineer', 'automation developer', 'integration developer', 'integration engineer', 'software developer', 'software engineer', 'scripting'],
  cloud: ['cloud engineer', 'cloud developer', 'cloud consultant', 'infrastructure engineer', 'infra engineer', 'infrastructure consultant', 'system engineer', 'systems engineer', 'system administrator', 'systeembeheerder', 'systeemingenieur', 'aws engineer', 'azure engineer', 'gcp engineer', 'vmware engineer', 'platform engineer'],
  infra: ['infrastructure engineer', 'system engineer', 'systems engineer', 'ict engineer', 'it engineer', 'systeembeheerder', 'netwerkbeheerder', 'network engineer', 'system administrator'],
  devops: ['devops engineer', 'devops', 'platform engineer', 'site reliability engineer', 'sre', 'build engineer', 'release engineer', 'cloud engineer', 'automation engineer', 'ci/cd'],
  data: ['data analyst', 'data analist', 'data engineer', 'bi analyst', 'bi developer', 'bi consultant', 'business intelligence', 'power bi developer', 'power bi consultant', 'reporting analyst', 'analytics engineer', 'data consultant'],
  bi: ['bi analyst', 'bi developer', 'bi consultant', 'business intelligence', 'power bi', 'reporting analyst'],
};

// Synoniemen / schrijfwijzen per skill uit het CV.
const SKILL_ALIASES = {
  'python': ['python'],
  'fastapi': ['fastapi'],
  'node.js': ['node.js', 'nodejs', 'node js'],
  'javascript': ['javascript', 'typescript'],
  "rest api's": ['rest api', 'rest apis', 'restful', 'rest-api'],
  "api's": ['api', 'apis'],
  'api-integraties': ['api integration', 'api integrations', 'api-integratie', 'integraties', 'integrations'],
  'authenticatie': ['authentication', 'authenticatie', 'oauth', 'jwt'],
  'caching': ['caching', 'redis'],
  'testing': ['testing', 'unit test', 'pytest', 'test automation'],
  'sql': ['sql'],
  'mysql': ['mysql'],
  'git': ['git', 'github', 'gitlab'],
  'docker': ['docker', 'container', 'containers', 'kubernetes'],
  'vercel': ['vercel'],
  'google cloud': ['google cloud', 'gcp'],
  'aws': ['aws', 'amazon web services'],
  'vmware (vcf)': ['vmware', 'vcf', 'vsphere'],
  'vmware': ['vmware', 'vsphere'],
  'ansible': ['ansible', 'infrastructure as code'],
  'documentatie': ['documentation', 'documentatie'],
  'migratieplanning': ['migration', 'migratie'],
  'excel': ['excel'],
  'power bi': ['power bi', 'powerbi'],
  'dashboards': ['dashboard', 'dashboards', 'reporting', 'rapportering'],
  'web scraping': ['web scraping', 'scraping'],
  'zapier': ['zapier', 'make.com', 'n8n', 'power automate', 'workflow automation'],
  'airtable': ['airtable', 'low-code', 'no-code'],
  'monitoring': ['monitoring', 'observability', 'grafana', 'prometheus'],
  'logging': ['logging'],
};

// Algemene skills tellen minder zwaar dan specifieke technologie.
const LOW_WEIGHT = new Set(['documentatie', 'migratieplanning', 'testing', 'git', 'excel', 'logging', 'monitoring', "api's", 'dashboards', 'caching']);

function rolesForTitle(title) {
  const t = title.toLowerCase();
  const roles = new Set();
  for (const [key, list] of Object.entries(ROLE_SYNONYMS)) {
    if (t.includes(key)) list.forEach((r) => roles.add(r));
  }
  return [...roles];
}

function parseCv(path) {
  const lines = docxToText(path).split('\n');
  // Titel: eerste regel die op een functie lijkt (meestal net onder de naam).
  const title =
    lines.find((l) => /\b(developer|engineer|analyst|analist|consultant|ontwikkelaar|beheerder)\b/i.test(l) && l.length < 60) || '';
  const start = lines.findIndex((l) => /^skills$/i.test(l));
  const end = lines.findIndex((l, i) => i > start && /^(opleiding|education|certificaties|talen)$/i.test(l));
  const rawSkills = start >= 0 ? lines.slice(start + 1, end > start ? end : start + 8).join(',') : '';
  const skills = rawSkills
    .split(/,|;|\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => ({
      name: s,
      aliases: SKILL_ALIASES[s] || [s],
      weight: LOW_WEIGHT.has(s) ? 0.5 : 1,
    }));
  return { title, skills };
}

function findCvs(dir) {
  const out = [];
  const walk = (d, depth) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (/\.docx$/i.test(name) && !name.startsWith('~$')) out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

export function buildProfile() {
  const settings = loadSettings();
  const cvDir = resolve(ROOT, settings.cvFolder);
  if (!existsSync(cvDir)) {
    throw new Error(`CV-map niet gevonden: ${cvDir}  (pas "cvFolder" aan in config/settings.json)`);
  }
  const files = findCvs(cvDir);
  if (!files.length) throw new Error(`Geen .docx CV's gevonden in ${cvDir}`);

  const profiles = files.map((f) => {
    const { title, skills } = parseCv(f);
    // Profielnaam = naam van de submap (bv. "Backend"), anders de bestandsnaam.
    const parent = basename(dirname(f));
    const name = resolve(dirname(f)) === cvDir ? basename(f, '.docx') : parent;
    return { name, cv: f, title, roles: rolesForTitle(title), skills };
  });

  const profile = { generatedAt: new Date().toISOString(), cvFolder: cvDir, profiles };
  writeFileSync(resolve(ROOT, 'config', 'profile.json'), JSON.stringify(profile, null, 2));
  return profile;
}

// Rechtstreeks uitgevoerd: `npm run keywords`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = buildProfile();
  for (const pr of p.profiles) {
    console.log(`\n▶ ${pr.name}: ${pr.title}`);
    console.log(`  rollen : ${pr.roles.join(', ')}`);
    console.log(`  skills : ${pr.skills.map((s) => s.name).join(', ')}`);
  }
  console.log(`\nOpgeslagen in config/profile.json`);
}
