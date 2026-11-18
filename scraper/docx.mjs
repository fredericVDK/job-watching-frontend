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
