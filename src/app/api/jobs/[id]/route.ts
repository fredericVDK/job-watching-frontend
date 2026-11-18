import { NextRequest, NextResponse } from 'next/server';
import { markSeen, setStatus } from '@/lib/db';
import type { JobStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: JobStatus[] = ['new', 'seen', 'saved', 'applied', 'hidden'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 });
  try {
    if (body.seen) markSeen(id);
    else if (STATUSES.includes(body.status)) setStatus(id, body.status);
    else return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Kon status niet opslaan' }, { status: 500 });
  }
}
