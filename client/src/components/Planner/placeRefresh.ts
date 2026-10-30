import { normalizePlaceWebsite, parsePlaceHours } from '@trek/shared';
import type { PlaceFormData } from './PlaceFormModal.helpers';
import { cleanWeek, weekFromPeriods, writeWeek } from './placeHours';

/** The details a saved place can take over from a fresh lookup. */
const REFRESH_FIELDS = ['website', 'phone', 'email', 'opening_hours'] as const;
export type RefreshField = (typeof REFRESH_FIELDS)[number];

/** One field where the lookup says something else than the place holds now. */
export interface RefreshCandidate {
  field: RefreshField;
  /** What the form holds, as stored; empty when it holds nothing. */
  current: string;
  /** What the lookup has, in the form's own format (hours as the stored week). */
  next: string;
  /** An empty field takes the new value without asking; a filled one is the person's call. */
  preselected: boolean;
}

type Details = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The lookup's value of a field, written the way the form stores it. */
function freshValue(field: RefreshField, details: Details): string {
  if (field === 'website') return normalizePlaceWebsite(text(details.website)) ?? '';
  if (field === 'opening_hours') {
    const week = weekFromPeriods(details.opening_periods as Parameters<typeof weekFromPeriods>[0]);
    return week ? writeWeek(cleanWeek(week)) : '';
  }
  return text(details[field]);
}

/** Two values that say the same in a different spelling count as one. */
function sameValue(field: RefreshField, a: string, b: string): boolean {
  if (field === 'phone') return a.replace(/[^\d+]/g, '') === b.replace(/[^\d+]/g, '');
  if (field === 'website')
    return (normalizePlaceWebsite(a) ?? a).replace(/\/$/, '').toLowerCase() === b.replace(/\/$/, '').toLowerCase();
  if (field === 'email') return a.toLowerCase() === b.toLowerCase();
  if (field === 'opening_hours') {
    const week = parsePlaceHours(a);
    return (week ? writeWeek(cleanWeek(week)) : a) === b;
  }
  return a === b;
}

/**
 * The fields where a fresh lookup of a saved place differs from what the form
 * holds. A field the lookup knows nothing about is never offered: refreshing
 * must not empty what the place already has.
 */
export function refreshCandidates(form: PlaceFormData, details: Details | null | undefined): RefreshCandidate[] {
  if (!details) return [];
  const out: RefreshCandidate[] = [];
  for (const field of REFRESH_FIELDS) {
    const next = freshValue(field, details);
    if (!next) continue;
    const current = (form[field] ?? '').trim();
    if (current && sameValue(field, current, next)) continue;
    out.push({ field, current, next, preselected: current === '' });
  }
  return out;
}
