'use client';

import { useState } from 'react';
import { ArrowUpRight, Bookmark, BookmarkCheck, Check, ChevronDown, EyeOff, MapPin, RotateCcw, Building2, Wifi, AlertTriangle } from 'lucide-react';
import type { Job, JobStatus } from '@/types';
import { cn, relativeDay, sourceLabel } from '@/lib/utils';

interface Props {
  job: Job;
  isNewRun: boolean;
  onStatus: (job: Job, status: JobStatus) => void;
  onOpen: (job: Job) => void;
}

function scoreTone(score: number) {
  if (score >= 12) return 'bg-[var(--accent)] text-white';
  if (score >= 8) return 'bg-[var(--accent-soft)] text-[var(--accent-ink)]';
  return 'bg-[var(--muted-bg)] text-[var(--ink-2)]';
}

export function JobRow({ job, isNewRun, onStatus, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const saved = job.status === 'saved';
  const applied = job.status === 'applied';
  const hidden = job.status === 'hidden';

  return (
    <article
      className={cn(
        'group relative grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-b border-[var(--line)] px-4 py-5 sm:px-6 transition-colors hover:bg-[var(--hover)]',
        applied && 'opacity-70',
      )}
    >
      {/* Score */}
      <div className="row-span-2 flex flex-col items-center gap-1 pt-0.5">
        <span className={cn('font-mono text-sm font-semibold tabular-nums rounded-md min-w-[2.75rem] text-center px-1.5 py-1', scoreTone(job.score))}>
          {job.score.toFixed(job.score % 1 ? 1 : 0)}
        </span>
        {job.status === 'new' && isNewRun && <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">nieuw</span>}
      </div>

      {/* Titel + meta */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpen(job)}
            className="text-[1.05rem] font-semibold leading-snug text-[var(--ink)] decoration-[var(--accent)] decoration-2 underline-offset-4 hover:underline"
          >
            {job.title}
          </a>
          {job.best_cv && (
            <span className="font-mono text-[11px] uppercase tracking-wide rounded border border-[var(--line-strong)] px-1.5 py-0.5 text-[var(--ink-2)]" title="Dit CV past het best bij deze vacature">
              CV · {job.best_cv.replace('_', ' / ')}
            </span>
          )}
          {applied && <span className="font-mono text-[11px] uppercase tracking-wide rounded bg-[var(--ok-bg)] px-1.5 py-0.5 text-[var(--ok)]">gesolliciteerd</span>}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--ink-2)]">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ink)]">
            <Building2 className="h-3.5 w-3.5 opacity-60" />
            {job.company || 'Onbekend bedrijf'}
          </span>
          {job.location && (
            <span className="inline-flex items-center gap-1.5 max-w-[28rem] truncate" title={job.location}>
              <MapPin className="h-3.5 w-3.5 opacity-60 shrink-0" />
              <span className="truncate">{job.location}</span>
            </span>
          )}
          {job.remote && (
            <span className="inline-flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5 opacity-60" /> remote
            </span>
          )}
          <span className="font-mono text-xs text-[var(--ink-3)]">
            {sourceLabel(job.source)} · gevonden {relativeDay(job.first_seen_at)}
          </span>
          {job.stale && (
            <span className="inline-flex items-center gap-1 font-mono text-xs text-[var(--warn)]" title="Niet meer teruggevonden bij de laatste runs">
              <AlertTriangle className="h-3 w-3" /> mogelijk offline
            </span>
          )}
        </div>
      </div>

      {/* Tags + acties */}
      <div className="col-start-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {job.matched.slice(0, 8).map((m) => (
            <span key={m} className="rounded-full bg-[var(--chip)] px-2.5 py-0.5 text-xs text-[var(--ink-2)]">
              {m}
            </span>
          ))}
          {job.snippet && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-[var(--ink-3)] hover:text-[var(--ink)]"
            >
              {open ? 'minder' : 'beschrijving'}
              <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconBtn
            label={saved ? 'Niet meer bewaren' : 'Bewaren'}
            active={saved}
            onClick={() => onStatus(job, saved ? 'seen' : 'saved')}
          >
            {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </IconBtn>
          <IconBtn
            label={applied ? 'Toch niet gesolliciteerd' : 'Markeer als gesolliciteerd'}
            active={applied}
            onClick={() => onStatus(job, applied ? 'seen' : 'applied')}
          >
            <Check className="h-4 w-4" />
          </IconBtn>
          <IconBtn label={hidden ? 'Terugzetten' : 'Verbergen (niet interessant)'} onClick={() => onStatus(job, hidden ? 'seen' : 'hidden')}>
            {hidden ? <RotateCcw className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </IconBtn>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpen(job)}
            className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--ink)] px-3.5 py-2 text-sm font-medium text-[var(--paper)] transition-transform hover:-translate-y-px active:translate-y-0"
          >
            Solliciteer <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </div>

      {open && (
        <p className="col-start-2 whitespace-pre-line rounded-lg bg-[var(--muted-bg)] p-4 text-sm leading-relaxed text-[var(--ink-2)]">
          {job.snippet}
          {job.snippet.length >= 600 && '…'}
        </p>
      )}
    </article>
  );
}

function IconBtn({ children, label, active, onClick }: { children: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg border border-transparent text-[var(--ink-3)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)]',
        active && 'border-[var(--accent-soft)] bg-[var(--accent-soft)] text-[var(--accent-ink)]',
      )}
    >
      {children}
    </button>
  );
}
