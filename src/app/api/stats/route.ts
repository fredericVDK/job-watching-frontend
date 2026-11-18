import { NextResponse } from 'next/server';
import { getStats } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(getStats());
  } catch (error) {
    console.error('Stats error:', error);
    return NextResponse.json({ error: 'Kon statistieken niet laden' }, { status: 500 });
  }
}
