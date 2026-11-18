import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getStats } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Start de scraper op de achtergrond ("Nu zoeken"-knop in de app).
export async function POST() {
  if (getStats().running) return NextResponse.json({ ok: false, error: 'Er loopt al een zoekrun' }, { status: 409 });
  const script = path.join(process.cwd(), 'scraper', 'run.mjs');
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', script], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return NextResponse.json({ ok: true }, { status: 202 });
}
