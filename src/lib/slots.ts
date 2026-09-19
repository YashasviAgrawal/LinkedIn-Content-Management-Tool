import { env } from "./env";
import { db } from "./supabase";
import {
  DAY_NAMES,
  addDays,
  localDateTimeToUtc,
  todayLocal,
  weekdayOf,
} from "./time";
import type { PostStatus, Slot, SlotOccurrence } from "./types";

/** Statuses that make an instant unavailable. A draft never holds a slot. */
const OCCUPYING: PostStatus[] = ["scheduled", "publishing", "published", "manual_required"];

/** Don't offer a slot that is about to fire — the publisher may already be mid-tick. */
const LEAD_MINUTES = 10;

export async function activeSlots(): Promise<Slot[]> {
  const { data, error } = await db()
    .from("slots")
    .select("*")
    .eq("active", true)
    .order("day_of_week")
    .order("time_local");
  if (error) throw new Error(`Could not read slots: ${error.message}`);
  return (data ?? []) as Slot[];
}

interface ExpandOptions {
  /** Local 'YYYY-MM-DD' to start from. Defaults to today. */
  from?: string;
  /** How many days forward to project. */
  days?: number;
  /** Include occurrences already in the past (the calendar wants these). */
  includePast?: boolean;
}

/**
 * Project the weekly slot template forward onto real dates and mark which
 * instants are already spoken for.
 *
 * This is the answer to "which slot is empty?" — and it is deliberately read
 * only. The actual booking relies on the partial unique index on
 * posts.scheduled_at, so two writers who both saw the same free slot cannot
 * both take it.
 */
export async function expandSlots(options: ExpandOptions = {}): Promise<SlotOccurrence[]> {
  const tz = env.timezone;
  const from = options.from ?? todayLocal(tz);
  const days = options.days ?? 21;
  const slots = await activeSlots();
  if (slots.length === 0) return [];

  const byDay = new Map<number, Slot[]>();
  for (const s of slots) {
    const list = byDay.get(s.day_of_week) ?? [];
    list.push(s);
    byDay.set(s.day_of_week, list);
  }

  const cutoff = Date.now() + LEAD_MINUTES * 60_000;
  const occurrences: SlotOccurrence[] = [];

  for (let i = 0; i < days; i++) {
    const localDate = addDays(from, i);
    const dow = weekdayOf(localDate);
    for (const slot of byDay.get(dow) ?? []) {
      const at = localDateTimeToUtc(localDate, slot.time_local, tz);
      if (!options.includePast && at.getTime() < cutoff) continue;
      occurrences.push({
        slot_id: slot.id,
        scheduled_at: at.toISOString(),
        local_date: localDate,
        local_time: slot.time_local,
        day_of_week: dow,
        day_name: DAY_NAMES[dow],
        label: slot.label,
        preferred: slot.preferred,
        taken: false,
        taken_by: null,
      });
    }
  }

  if (occurrences.length === 0) return [];

  occurrences.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const { data: booked, error } = await db()
    .from("posts")
    .select("id, title, status, scheduled_at")
    .in("status", OCCUPYING)
    .gte("scheduled_at", occurrences[0].scheduled_at)
    .lte("scheduled_at", occurrences[occurrences.length - 1].scheduled_at);
  if (error) throw new Error(`Could not read booked posts: ${error.message}`);

  // Postgres and JS can format the same instant differently ('+00:00' vs 'Z',
  // microseconds vs milliseconds), so key on epoch milliseconds instead.
  const taken = new Map<number, { id: string; title: string; status: PostStatus }>();
  for (const p of booked ?? []) {
    if (!p.scheduled_at) continue;
    taken.set(new Date(p.scheduled_at).getTime(), {
      id: p.id,
      title: p.title,
      status: p.status as PostStatus,
    });
  }

  for (const o of occurrences) {
    const hit = taken.get(new Date(o.scheduled_at).getTime());
    if (hit) {
      o.taken = true;
      o.taken_by = hit;
    }
  }

  return occurrences;
}

/** The earliest free slot, or null if the grid is full for the window. */
export async function nextFreeSlot(
  after?: string,
  days = 60,
): Promise<SlotOccurrence | null> {
  const list = await expandSlots({ from: after, days });
  return list.find((o) => !o.taken) ?? null;
}

/** The next `count` free slots — what Claude Code asks for when planning a week. */
export async function nextFreeSlots(
  count: number,
  after?: string,
  days = 60,
): Promise<SlotOccurrence[]> {
  const list = await expandSlots({ from: after, days });
  return list.filter((o) => !o.taken).slice(0, count);
}

/** Is this exact instant already occupied? Returns the occupying post if so. */
export async function instantTakenBy(
  isoInstant: string,
  ignorePostId?: string,
): Promise<{ id: string; title: string; status: PostStatus } | null> {
  const { data, error } = await db()
    .from("posts")
    .select("id, title, status")
    .eq("scheduled_at", new Date(isoInstant).toISOString())
    .in("status", OCCUPYING)
    .limit(2);
  if (error) throw new Error(`Could not check the slot: ${error.message}`);

  const hit = (data ?? []).find((p) => p.id !== ignorePostId);
  return hit ? { id: hit.id, title: hit.title, status: hit.status as PostStatus } : null;
}

/** Match an instant back to the slot template row it came from, if any. */
export async function slotIdForInstant(isoInstant: string): Promise<string | null> {
  const tz = env.timezone;
  const { utcToLocalParts } = await import("./time");
  const parts = utcToLocalParts(isoInstant, tz);
  const slots = await activeSlots();
  const hit = slots.find(
    (s) => s.day_of_week === parts.weekday && s.time_local === parts.time,
  );
  return hit?.id ?? null;
}
