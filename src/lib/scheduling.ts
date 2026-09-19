import { env } from "./env";
import type { ScheduleInput } from "./schemas";
import { nextFreeSlot, slotIdForInstant } from "./slots";
import { localDateTimeToUtc } from "./time";

export class NoFreeSlotError extends Error {
  constructor() {
    super(
      "No free slot in the next 60 days. Add slots on the /slots page, or pass an explicit time.",
    );
    this.name = "NoFreeSlotError";
  }
}

/**
 * Turn any of the three ways a caller can name a time into one UTC instant:
 *
 *   { scheduled_at: '2026-09-22T03:15:00Z' }      explicit instant
 *   { local_date: '2026-09-22', local_time: '08:45' }  wall clock in APP_TIMEZONE
 *   { slot: 'next' }                              the earliest free slot on the grid
 *
 * The third is what Claude Code uses: it does not need to know the grid, only
 * that it wants the next opening.
 */
export async function resolveScheduleTime(
  input: Omit<Partial<ScheduleInput>, "scheduled_at" | "force"> & {
    // The update path allows an explicit null to clear a booking; callers strip
    // that case before they get here, so it is accepted and then rejected below
    // rather than failing to typecheck at every call site.
    scheduled_at?: string | null;
  },
): Promise<{ instant: Date; slotId: string | null; pickedSlot: boolean }> {
  if (input.slot === "next") {
    const free = await nextFreeSlot(input.after);
    if (!free) throw new NoFreeSlotError();
    return { instant: new Date(free.scheduled_at), slotId: free.slot_id, pickedSlot: true };
  }

  if (input.local_date && input.local_time) {
    const instant = localDateTimeToUtc(input.local_date, input.local_time, env.timezone);
    return { instant, slotId: await slotIdForInstant(instant.toISOString()), pickedSlot: false };
  }

  if (input.scheduled_at) {
    const instant = new Date(input.scheduled_at);
    if (Number.isNaN(instant.getTime())) {
      throw new Error(`Could not read scheduled_at: ${input.scheduled_at}`);
    }
    return { instant, slotId: await slotIdForInstant(instant.toISOString()), pickedSlot: false };
  }

  throw new Error("Provide scheduled_at, or local_date + local_time, or slot:'next'");
}

/**
 * Postgres raises 23505 on the partial unique index over posts.scheduled_at.
 * That is the real double-booking guard — this only translates it into
 * something a human or an agent can act on.
 */
export function isSlotConflict(error: { code?: string; message?: string; details?: string } | null): boolean {
  if (!error || error.code !== "23505") return false;
  // Match the index by name, not just the code — `posts.slug` is unique too,
  // and reporting a duplicate title as "that slot is taken" would send the
  // caller looking in entirely the wrong place.
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return text.includes("posts_unique_scheduled_at") || text.includes("scheduled_at");
}

export function isSlugConflict(error: { code?: string; message?: string; details?: string } | null): boolean {
  if (!error || error.code !== "23505") return false;
  return `${error.message ?? ""} ${error.details ?? ""}`.includes("slug");
}
