export interface Job {
  url: string;
  title: string;
  company: string;
  location: string;
  date: string;
}

export interface Stats {
  totalJobs: number;
  companies: number;
  latestJob: string | null;
}
