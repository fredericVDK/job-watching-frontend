export type JobStatus = 'new' | 'seen' | 'saved' | 'applied' | 'hidden';
export type View = 'new' | 'todo' | 'saved' | 'applied' | 'hidden' | 'all';

export interface Job {
  id: number;
  url: string;
  source: string;
  company: string | null;
  title: string;
  location: string | null;
  remote: boolean;
  snippet: string;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  first_run_id: number;
  score: number;
  best_cv: string | null;
  matched: string[];
  status: JobStatus;
  status_at: string | null;
  stale: boolean;
  distance_km: number | null;
  loc_kind: 'near' | 'remote' | 'unknown' | 'far' | 'foreign' | null;
  note: string | null; // bv. "In je sheet (Gesolliciteerd): Qargo – Backend Software Engineer, 02/05/2026"
 // niet meer gezien in de laatste runs -> mogelijk offline
}

export interface RunInfo {
  id: number;
  started_at: string;
  finished_at: string | null;
  total_found: number;
  matched: number;
  new_jobs: number;
  status: string;
  sources: Record<string, { found: number; new: number; error?: string; skipped?: string }> | null;
}

export interface Stats {
  counts: Record<View, number>;
  lastRun: RunInfo | null;
  runs: RunInfo[];
  profiles: string[];
  running: boolean;
}
