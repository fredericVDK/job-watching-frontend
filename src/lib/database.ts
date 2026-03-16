import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const DB_PATH = '../jobs.db';

export interface Job {
  url: string;
  title: string;
  company: string;
  date: string;
}

export class Database {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
  }

  async getAllJobs(): Promise<Job[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT url, company, title, location, first_seen_at FROM seen_jobs ORDER BY first_seen_at DESC', (err, rows: any[]) => {
        if (err) {
          console.error('Error fetching jobs:', err);
          reject(err);
        } else {
          console.log(`Found ${rows.length} jobs`);
          resolve(rows.map(row => ({
            url: row.url,
            title: row.title,
            company: row.company,
            location: row.location || '',
            date: row.first_seen_at
          })) as Job[]);
        }
      });
    });
  }

  async getJobsByCompany(company: string): Promise<Job[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT url, company, title, location, first_seen_at FROM seen_jobs WHERE company = ? ORDER BY first_seen_at DESC', [company], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(row => ({
            url: row.url,
            title: row.title,
            company: row.company,
            location: row.location || '',
            date: row.first_seen_at
          })) as Job[]);
        }
      });
    });
  }

  async searchJobs(query: string): Promise<Job[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT url, company, title, location, first_seen_at FROM seen_jobs WHERE title LIKE ? OR company LIKE ? ORDER BY first_seen_at DESC',
        [`%${query}%`, `%${query}%`],
        (err, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map(row => ({
              url: row.url,
              title: row.title,
              company: row.company,
              location: row.location || '',
              date: row.first_seen_at
            })) as Job[]);
          }
        }
      );
    });
  }

  close() {
    this.db.close();
  }
}

export const db = new Database();
