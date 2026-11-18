'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, Radar, X } from 'lucide-react';
import type { Job, JobStatus, Stats, View } from '@/types';
import { JobRow } from '@/components/JobRow';
import { cn, relativeDay, timeOfDay } from '@/lib/utils';

const TABS: { id: View; label: string; hint: string }[] = [
  { id: 'new', label: 'Nieuw', hint: 'Gevonden in de laatste zoekrun' },
  { id: 'todo', label: 'Te bekijken', hint: 'Alles wat je nog niet geopend hebt' },
  { id: 'saved', label: 'Bewaard', hint: 'Jobs die je bewaard hebt' },
  { id: 'applied', label: 'Gesolliciteerd', hint: 'Waar je al op gesolliciteerd hebt' },
  { id: 'all', label: 'Alles', hint: 'Alle gevonden jobs (behalve verborgen)' },
  { id: 'hidden', label: 'Verborgen', hint: 'Jobs die je verborgen hebt' },
];

const belongs = (view: View, status: JobStatus) =>
  ({
    new: status !== 'hidden',
    todo: status === 'new',
    saved: status === 'saved',
    applied: status === 'applied',
    hidden: status === 'hidden',
    all: status !== 'hidden',
  })[view];

export default function Home() {
  const [view, setView] = useState<View>('new');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cv, setCv] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<'score' | 'date'>('score');
  const [starting, setStarting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadStats = useCallback(async () => {
    const r = await fetch('/api/stats', { cache: 'no-store' });
    if (r.ok) setStats(await r.json());
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ view, sort, minScore: String(minScore) });
    if (debounced) p.set('q', debounced);
    if (cv) p.set('cv', cv);
    try {
      const r = await fetch(`/api/jobs?${p}`, { cache: 'no-store' });
      if (r.ok) setJobs(await r.json());
    } finally {
      setLoading(false);
    }
  }, [view, sort, minScore, debounced, cv]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // Tijdens een zoekrun elke 5s verversen
  const running = stats?.running || starting;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) { wasRunning.current = false; loadJobs(); }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => { loadStats(); }, 5000);
    return () => clearInterval(t);
  }, [running, loadStats, loadJobs]);

  // "/" focust de zoekbalk
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updateStatus = async (job: Job, status: JobStatus) => {
    setJobs((list) =>
      list.map((j) => (j.id === job.id ? { ...j, status } : j)).filter((j) => j.id !== job.id || belongs(view, status)),
    );
    await fetch(`/api/jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadStats();
  };

  const onOpen = (job: Job) => {
    if (job.status !== 'new') return;
    fetch(`/api/jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ seen: true }), keepalive: true }).then(loadStats);
    setJobs((list) => list.map((j) => (j.id === job.id ? { ...j, status: 'seen' as JobStatus } : j)).filter((j) => j.id !== job.id || belongs(view, 'seen')));
  };

  const startRun = async () => {
    setStarting(true);
    await fetch('/api/scrape', { method: 'POST' });
    setTimeout(() => { setStarting(false); loadStats(); }, 3000);
  };

  const lastRun = stats?.lastRun;
  const lastRunId = lastRun?.id ?? 0;
  const filtersActive = !!(query || cv || minScore);
  const sourceSummary = useMemo(() => {
    if (!lastRun?.sources) return [];
    return Object.entries(lastRun.sources).map(([k, v]) => ({ k, ...v }));
  }, [lastRun]);

  return (
    <div className="min-h-screen">
      {/* Kop */}
      <header className="border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[var(--ink-3)]">
                <Radar className="h-4 w-4 text-[var(--accent)]" /> JobWatcher
              </div>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--ink)]">
                {stats ? (
                  <>
                    <span className="tabular-nums">{stats.counts.new}</span> nieuwe {stats.counts.new === 1 ? 'job' : 'jobs'} voor jou
                  </>
                ) : (
                  'Jobs voor jou'
                )}
              </h1>
              <p className="mt-2 text-sm text-[var(--ink-2)]">
                {lastRun ? (
                  <>
                    Laatste zoekrun {relativeDay(lastRun.finished_at || lastRun.started_at)} om {timeOfDay(lastRun.finished_at || lastRun.started_at)} ·{' '}
                    {lastRun.total_found.toLocaleString('nl-BE')} vacatures bekeken
                  </>
                ) : (
                  'Nog geen zoekrun gedaan. Klik op "Nu zoeken" of voer npm run scrape uit.'
                )}
              </p>
            </div>
            <button
              onClick={startRun}
              disabled={running}
              className="inline-flex items-center justify-center gap-2 self-start md:self-auto rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--hover)] disabled:opacity-60"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {running ? 'Bezig met zoeken…' : 'Nu zoeken'}
            </button>
          </div>

          {sourceSummary.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-[var(--ink-3)]">
              {sourceSummary.map((s) => (
                <span key={s.k} title={s.error || s.skipped || ''} className={cn(s.error && 'text-[var(--warn)]')}>
                  {s.k === 'companies' ? 'bedrijven' : s.k} {s.skipped ? '— uit' : s.error ? '— fout' : `${s.found} → +${s.new}`}
                </span>
              ))}
            </div>
          )}

          {/* Tabs */}
          <nav className="mt-6 -mb-6 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                title={t.hint}
                onClick={() => setView(t.id)}
                className={cn(
                  'relative whitespace-nowrap px-3 pb-3 pt-1 text-sm transition-colors',
                  view === t.id ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-3)] hover:text-[var(--ink)]',
                )}
              >
                {t.label}
                <span className="ml-1.5 font-mono text-xs tabular-nums opacity-70">{stats?.counts[t.id] ?? ''}</span>
                {view === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-[var(--accent)]" />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-0 sm:px-6 py-6">
        {/* Filters */}
        <div className="flex flex-col gap-3 px-4 sm:px-0 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-3)]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op titel, bedrijf, plaats of skill…  ( / )"
              className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] py-2.5 pl-9 pr-9 text-sm outline-none placeholder:text-[var(--ink-3)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)] hover:text-[var(--ink)]" aria-label="Wissen">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              <Chip active={!cv} onClick={() => setCv('')}>Alle CV&apos;s</Chip>
              {(stats?.profiles ?? []).map((p) => (
                <Chip key={p} active={cv === p} onClick={() => setCv(cv === p ? '' : p)}>
                  {p.replace('_', ' / ')}
                </Chip>
              ))}
            </div>
            <select
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-2.5 py-2 text-sm"
              title="Minimum matchscore"
            >
              <option value={0}>Alle scores</option>
              <option value={8}>Score ≥ 8</option>
              <option value={10}>Score ≥ 10</option>
              <option value={12}>Score ≥ 12</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'score' | 'date')}
              className="rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-2.5 py-2 text-sm"
            >
              <option value="score">Beste match eerst</option>
              <option value="date">Nieuwste eerst</option>
            </select>
          </div>
        </div>

        {/* Lijst */}
        <section className="mt-5 overflow-hidden border-y sm:border sm:rounded-xl border-[var(--line)] bg-[var(--paper)]">
          {loading && jobs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-[var(--ink-2)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Jobs laden…
            </div>
          ) : jobs.length === 0 ? (
            <Empty view={view} filtersActive={filtersActive} hasRun={!!lastRun} />
          ) : (
            jobs.map((job) => (
              <JobRow key={job.id} job={job} isNewRun={job.first_run_id === lastRunId} onStatus={updateStatus} onOpen={onOpen} />
            ))
          )}
        </section>
        {jobs.length > 0 && (
          <p className="mt-4 px-4 sm:px-0 font-mono text-xs text-[var(--ink-3)]">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} · score = hoe goed de vacature bij je CV&apos;s past (rol, skills, junior, regio Gent)
          </p>
        )}
      </main>
    </div>
  );
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs transition-colors',
        active ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]' : 'border-[var(--line-strong)] text-[var(--ink-2)] hover:border-[var(--ink-3)]',
      )}
    >
      {children}
    </button>
  );
}

function Empty({ view, filtersActive, hasRun }: { view: View; filtersActive: boolean; hasRun: boolean }) {
  const msg = filtersActive
    ? 'Geen jobs die aan je filters voldoen.'
    : !hasRun
      ? 'Nog geen resultaten. Start een zoekrun met de knop hierboven.'
      : ({
          new: 'Geen nieuwe jobs in de laatste zoekrun. Morgen opnieuw!',
          todo: 'Alles bekeken. Mooi zo.',
          saved: 'Nog niets bewaard. Gebruik het bladwijzer-icoon bij een job.',
          applied: 'Nog nergens als "gesolliciteerd" gemarkeerd.',
          hidden: 'Geen verborgen jobs.',
          all: 'Nog geen jobs gevonden.',
        } as Record<View, string>)[view];
  return <div className="py-20 text-center text-sm text-[var(--ink-2)]">{msg}</div>;
}
