// Airtable configuration
const AIRTABLE_PAT = process.env.AIRTABLE_PAT || 'patbODVsP51MOH5YY.0b6e08b16e1bf172f309475ef996609fdbdf46a6a0a857c8218b7cc6b7cf0c4d';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appyhNeHrg7LUy575';
const AIRTABLE_JOBS_TABLE = 'Jobs';
const AIRTABLE_COMPANIES_TABLE = 'Companies';

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
  latestJob: string | null;
}

// Airtable API helper functions
async function fetchFromAirtable(table: string, formula?: string) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}`;
  const params = formula ? `?filterByFormula=${encodeURIComponent(formula)}` : '';
  
  const response = await fetch(`${url}${params}`, {
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Airtable API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.records;
}

// Function to fetch jobs from Airtable
async function fetchJobsFromAirtable(): Promise<Job[]> {
  try {
    console.log('Fetching from Airtable...');
    console.log('Base ID:', AIRTABLE_BASE_ID);
    console.log('Table:', AIRTABLE_JOBS_TABLE);
    
    const records = await fetchFromAirtable(AIRTABLE_JOBS_TABLE);
    console.log('Records found:', records.length);
    console.log('Sample record:', records[0]?.fields);
    
    return records.map((record: any) => ({
      url: record.fields['job URL'] || record.fields['Job URL'] || '',
      company: record.fields['Company']?.[0] || 'Unknown',
      title: record.fields['job title'] || record.fields['Job Title'] || 'Unknown Position',
      location: record.fields['Location'] || 'Unknown',
      date: record.fields['Date Found'] || new Date().toISOString()
    }));
    
  } catch (error) {
    console.error('Error fetching from Airtable:', error);
    console.error('PAT length:', AIRTABLE_PAT?.length || 'undefined');
    console.error('Base ID:', AIRTABLE_BASE_ID);
    return [];
  }
}

export async function getAllJobs(): Promise<Job[]> {
  return await fetchJobsFromAirtable();
}

export async function getJobsByCompany(company: string): Promise<Job[]> {
  try {
    const formula = `FIND("${company}", {Company}) > 0`;
    const records = await fetchFromAirtable(AIRTABLE_JOBS_TABLE, formula);
    
    return records.map((record: any) => ({
      url: record.fields['Job URL'] || '',
      company: record.fields['Company']?.[0] || 'Unknown',
      title: record.fields['Job Title'] || 'Unknown Position',
      location: record.fields['Location'] || 'Unknown',
      date: record.fields['Date Found'] || new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error fetching jobs by company:', error);
    return [];
  }
}

export async function searchJobs(query: string): Promise<Job[]> {
  try {
    const formula = `OR(FIND("${query}", {Job Title}) > 0, FIND("${query}", {Company}) > 0, FIND("${query}", {Location}) > 0)`;
    const records = await fetchFromAirtable(AIRTABLE_JOBS_TABLE, formula);
    
    return records.map((record: any) => ({
      url: record.fields['Job URL'] || '',
      company: record.fields['Company']?.[0] || 'Unknown',
      title: record.fields['Job Title'] || 'Unknown Position',
      location: record.fields['Location'] || 'Unknown',
      date: record.fields['Date Found'] || new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error searching jobs:', error);
    return [];
  }
}

export async function getStats(): Promise<Stats> {
  try {
    const jobsRecords = await fetchFromAirtable(AIRTABLE_JOBS_TABLE);
    const companiesRecords = await fetchFromAirtable(AIRTABLE_COMPANIES_TABLE);
    
    const totalJobs = jobsRecords.length;
    const companies = companiesRecords.length;
    const latestJob = jobsRecords.length > 0 
      ? jobsRecords.reduce((latest: any, record: any) => {
          const jobDate = record.fields['Date Found'] || '';
          return jobDate > latest ? jobDate : latest;
        }, '')
      : null;
    
    return {
      totalJobs,
      companies,
      latestJob
    };
  } catch (error) {
    console.error('Error fetching stats:', error);
    return {
      totalJobs: 0,
      companies: 0,
      latestJob: null
    };
  }
}
