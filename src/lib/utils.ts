import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function relativeDay(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (days <= 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days < 7) return `${days} dagen geleden`;
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
}

export function timeOfDay(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
}

export function sourceLabel(source: string) {
  if (source.startsWith('company:')) return 'bedrijfssite';
  return ({ ictjob: 'ictjob.be', adzuna: 'Adzuna', remotive: 'Remotive', arbeitnow: 'Arbeitnow' } as Record<string, string>)[source] ?? source;
}
