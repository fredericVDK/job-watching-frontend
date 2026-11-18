// Minimale .docx-lezer: een .docx is een zip-bestand; we lezen enkel
// word/document.xml en halen de tekst eruit (geen externe packages).
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { decodeEntities } from './http.mjs';

function readZipEntry(buf, wanted) {
  // Zoek "End of central directory" record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geen geldig zip/docx-bestand');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} niet gevonden in docx`);
}

/** Geeft de tekst van een .docx terug, één paragraaf per regel. */
export function docxToText(path) {
  const xml = readZipEntry(readFileSync(path), 'word/document.xml').toString('utf8');
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('INCLUDEPICTURE'))
    .join('\n');
}

/** Minimale .xlsx-lezer: geeft [{ name, rows: string[][] }] per tabblad terug. */
export function readXlsx(path) {
  const buf = readFileSync(path);
  const get = (name) => { try { return readZipEntry(buf, name).toString('utf8'); } catch { return ''; } };
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
  const rels = Object.fromEntries([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(([t]) => [attr(t, 'Id'), attr(t, 'Target')]));
  const sheets = [...get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map(([t]) => [t, attr(t, 'name'), attr(t, 'r:id')]);
  const colIdx = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return sheets.map(([, name, rid]) => {
    const target = rels[rid] || '';
    const xml = get(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/t="(\w+)"/) || [])[1];
        const inner = cm[2] || '';
        let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? '';
        if (type === 's') v = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('');
        row[ref ? colIdx(ref) : row.length] = decodeEntities(String(v));
      }
      rows.push(Array.from(row, (x) => x ?? ''));
    }
    return { name: decodeEntities(name), rows };
  });
}
