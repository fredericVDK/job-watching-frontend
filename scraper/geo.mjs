// Afstand tot je thuisadres berekenen op basis van de locatietekst van een vacature.
// Gebruikt een lijst van alle Belgische (deel)gemeenten + postcodes met coördinaten
// (scraper/data/be-places.json, bron: github.com/jief/zipcode-belgium) – geen online API nodig.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'data', 'be-places.json'), 'utf8'));
const NAMES = Object.keys(DATA.places).sort((a, b) => b.length - a.length); // langste eerst ("sint-martens-latem" vóór "latem")

const norm = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Signalen dat een locatie in het buitenland ligt (bv. "Melle, Germany" is niet Melle bij Gent).
const FOREIGN = /\b(germany|deutschland|netherlands|nederland|holland|france|frankrijk|united kingdom|uk|england|london|spain|espana|portugal|italy|italia|poland|polska|austria|switzerland|schweiz|ireland|usa|united states|canada|india|romania|czech|denmark|sweden|norway|finland|luxembourg|luxemburg|berlin|munich|munchen|hamburg|amsterdam|rotterdam|utrecht|eindhoven|paris|lyon|madrid|barcelona|lisbon|lisboa|warsaw|krakow|prague|praha|vienna|wien|zurich|dublin|bucharest|new york|san francisco)\b/;
const BELGIUM = /\b(belgium|belgie|belgique|belgien|be|vlaanderen|flanders|wallonie|wallonia|oost vlaanderen|east flanders|west vlaanderen|antwerp province)\b/;
const REMOTE = /\b(remote|fully remote|volledig thuiswerk|thuiswerk|telewerk|work from home|home office|anywhere)\b/;

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Zoekt alle Belgische plaatsen/postcodes in een locatietekst. */
export function findPlaces(text) {
  let t = ` ${norm(text)} `;
  const found = [];
  for (const zip of t.match(/\b[1-9]\d{3}\b/g) || []) {
    if (DATA.zips[zip]) found.push({ name: zip, coords: [DATA.zips[zip]] });
  }
  for (const name of NAMES) {
    const needle = ` ${name} `;
    if (t.includes(needle)) {
      found.push({ name, coords: DATA.places[name] });
      t = t.split(needle).join(' '); // voorkomt dat "latem" nog eens matcht na "sint martens latem"
    }
  }
  return found;
}

// Woorden die géén plaats aanduiden. Blijft er na het wegfilteren nog iets over
// (bv. "Pune", "Milan", "US California - Office"), dan is het een plaats die niet in België ligt.
const FILLER = /\b(belgium|belgie|belgique|belgien|be|vlaanderen|flanders|vlaams gewest|flemish region|wallonie|wallonia|brussels capital|capital region|region|gewest|provincie|province|oost vlaanderen|east flanders|west vlaanderen|hybrid|hybride|remote|fully remote|full remote|volledig thuiswerk|thuiswerk|telewerk|work from home|home office|office|kantoor|hq|hoofdzetel|headquarters|on site|onsite|op locatie|multiple locations|meerdere locaties|various|flexible|flexibel|europe|european|emea|eu|benelux|worldwide|anywhere|global|cet|cest|timezone|time zone|based|or|and|en|of|in|only)\b/g;

/**
 * Bepaalt de afstand van een vacature tot je thuis.
 * @returns {{ km: number|null, kind: 'near'|'far'|'remote'|'unknown'|'foreign', place?: string, viaCompany?: boolean }}
 */
export function locate(job, home, maxKm) {
  const text = norm(job.location || '');
  const remote = !!job.remote || REMOTE.test(text);
  const isForeign = FOREIGN.test(text) && !BELGIUM.test(text);

  // Buitenlandse bron met buitenlandse plaats (bv. "Melle, Germany") -> niet als Belgische plaats lezen.
  // Een lijst als "Gand, Amsterdam, Eindhoven" bevat wél een Belgische plaats -> die telt.
  const places = isForeign && !job.belgian ? [] : findPlaces(text);
  if (places.length) {
    let best = { km: Infinity, place: '' };
    for (const p of places) for (const c of p.coords) {
      const km = haversineKm([home.lat, home.lng], c);
      if (km < best.km) best = { km, place: p.name };
    }
    const km = Math.round(best.km * 10) / 10;
    if (km <= maxKm) return { km, kind: 'near', place: best.place };
    return { km, kind: remote ? 'remote' : 'far', place: best.place };
  }

  const rest = text.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (rest) return { km: null, kind: 'foreign' }; // onbekende (buitenlandse) plaats

  // Enkel algemene woorden ("Belgium", "Hybrid", "Remote") of niets vermeld:
  if (job.companyCity) {
    const c = locate({ location: job.companyCity, belgian: true }, home, maxKm);
    if (c.km !== null) return { ...c, kind: c.kind === 'far' && remote ? 'remote' : c.kind, viaCompany: true };
  }
  if (remote) return { km: null, kind: 'remote' };
  if (job.belgian || BELGIUM.test(text)) return { km: null, kind: 'unknown' };
  return { km: null, kind: 'foreign' };
}
