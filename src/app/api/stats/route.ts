import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET() {
  try {
    const jobs = await db.getAllJobs();
    
    const companies = [...new Set(jobs.map(job => job.company))];
    
    const stats = {
      totalJobs: jobs.length,
      companies: companies.length,
      latestJob: jobs[0]?.date || null
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
