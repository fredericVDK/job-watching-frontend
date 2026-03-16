import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const search = searchParams.get('search');

    let jobs;
    if (company) {
      jobs = await db.getJobsByCompany(company);
    } else if (search) {
      jobs = await db.searchJobs(search);
    } else {
      jobs = await db.getAllJobs();
    }

    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}
