import { NextRequest, NextResponse } from 'next/server';
import { listJobs } from '@/lib/db';
import type { View } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIEWS: View[] = ['new', 'todo', 'saved', 'applied', 'hidden', 'all'];

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const view = (VIEWS.includes(p.get('view') as View) ? p.get('view') : 'new') as View;
  try {
    const jobs = listJobs({
      view,
      q: p.get('q')?.trim() || undefined,
      cv: p.get('cv') || undefined,
      minScore: Number(p.get('minScore') || 0),
      sort: p.get('sort') === 'date' ? 'date' : 'score',
    });
    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Kon jobs niet laden' }, { status: 500 });
  }
}
