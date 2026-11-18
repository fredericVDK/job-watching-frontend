import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  cvFolder: '../CV/Nieuw',
  minScore: 5,
  maxYearsExperience: 4,
  extraRoles: [],
  extraSkills: [],
  excludeTitleWords: [],
  excludeCompanies: [],
  home: { address: 'Brugsesteenweg 40, 9000 Gent', lat: 51.0641, lng: 3.694 },
  maxDistanceKm: 25,
  unknownLocation: 'keep',
  allowRemote: true,
  applications: {},
  sources: {},
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

export function loadSettings() {
  return { ...DEFAULTS, ...readJson(resolve(ROOT, 'config', 'settings.json'), {}) };
}

export function loadProfile() {
  const p = readJson(resolve(ROOT, 'config', 'profile.json'), null);
  if (!p) throw new Error('config/profile.json ontbreekt – voer eerst `npm run keywords` uit.');
  return p;
}

export function loadCompanies() {
  return readJson(resolve(ROOT, 'config', 'companies.json'), { companies: [] }).companies;
}

// Laadt .env (KEY=VALUE) zonder extra package.
export function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = resolve(ROOT, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
