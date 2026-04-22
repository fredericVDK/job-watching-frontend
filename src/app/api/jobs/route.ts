import { NextRequest, NextResponse } from 'next/server';
import { getAllJobs, getJobsByCompany, searchJobs } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const search = searchParams.get('search');

    let jobs;
    if (company) {
      jobs = await getJobsByCompany(company);
    } else if (search) {
      jobs = await searchJobs(search);
    } else {
      jobs = await getAllJobs();
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
