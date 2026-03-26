import fs from 'fs';
import path from 'path';

// Database path - use the deployed database (same directory)
const DB_PATH = path.join(process.cwd(), 'jobs.db');

export interface Job {
  url: string;
  company: string;
  title: string;
  location: string;
  date: string;
}

export interface Stats {
  totalJobs: number;
  companies: number;
  latestJob: string;
}

// Sample data for testing
const SAMPLE_JOBS: Job[] = [
  {
    url: 'https://crazygames.recruitee.com/o/remote-data-scientist',
    company: 'CrazyGames',
    title: '[REMOTE] Data Scientist',
    location: 'remote',
    date: '2026-03-16T15:41:39.074084'
  },
  {
    url: 'https://bothive.be/company/careers/stage_full_stack_development',
    company: 'Bothive',
    title: 'Development Stage Full Stack Developer',
    location: '',
    date: '2026-03-16T15:41:43.641106'
  }
];

// Function to parse SQLite database file properly
async function parseSQLiteFile(): Promise<Job[]> {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.log('Database file not found at:', DB_PATH);
      console.log('Using sample data for demonstration');
      return SAMPLE_JOBS;
    }

    // Since we can't use sqlite3 directly in Next.js edge runtime,
    // we'll use a Python script to read the database
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync(`python3 -c "
import sqlite3
import json

conn = sqlite3.connect('${DB_PATH}')
cursor = conn.cursor()
cursor.execute('SELECT url, company, title, location, first_seen_at FROM seen_jobs ORDER BY first_seen_at DESC')
rows = cursor.fetchall()

jobs = []
for row in rows:
    jobs.append({
        'url': row[0],
        'company': row[1],
        'title': row[2],
        'location': row[3],
        'date': row[4]
    })

print(json.dumps(jobs))
conn.close()
      "`);
      
      const jobs = JSON.parse(stdout);
      console.log(`Found ${jobs.length} jobs in database`);
      return jobs;
      
    } catch (pythonError) {
      console.error('Python script failed:', pythonError);
      console.log('Falling back to sample data');
      return SAMPLE_JOBS;
    }
    
  } catch (error) {
    console.error('Error parsing database:', error);
    console.log('Using sample data due to error');
    return SAMPLE_JOBS;
  }
}

export async function getAllJobs(): Promise<Job[]> {
  return await parseSQLiteFile();
}

export async function getJobsByCompany(company: string): Promise<Job[]> {
  const allJobs = await getAllJobs();
  return allJobs.filter(job => job.company.toLowerCase().includes(company.toLowerCase()));
}

export async function searchJobs(query: string): Promise<Job[]> {
  const allJobs = await getAllJobs();
  const searchTerm = query.toLowerCase();
  
  return allJobs.filter(job => 
    job.title.toLowerCase().includes(searchTerm) ||
    job.company.toLowerCase().includes(searchTerm) ||
    job.location.toLowerCase().includes(searchTerm)
  );
}

export async function getStats(): Promise<Stats> {
  const allJobs = await getAllJobs();
  const companies = new Set(allJobs.map(job => job.company));
  const latestJob = allJobs.length > 0 
    ? allJobs.reduce((latest, job) => 
        job.date > latest.date ? job : latest
      ).date
    : '';
    
  return {
    totalJobs: allJobs.length,
    companies: companies.size,
    latestJob
  };
}
