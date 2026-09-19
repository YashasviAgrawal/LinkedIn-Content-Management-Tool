import { boom, fail, guard, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { expandSlots } from "@/lib/slots";
import { db } from "@/lib/supabase";
import { addDays, todayLocal, utcToLocalParts } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calendar?from=YYYY-MM-DD&days=42
 *
 * One call that feeds the whole board: the posts in the window keyed by local
 * date, plus the empty slot openings so the grid can show what is available
 * rather than only what is booked.
 */
export async function GET(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const tz = env.timezone;
    const from = url.searchParams.get("from") ?? todayLocal(tz);
    const days = Math.min(Number(url.searchParams.get("days") ?? 42), 180);
    const to = addDays(from, days);

    // Widen by a day on each side so a post near midnight local time is not
    // dropped by the UTC comparison.
    const { data: posts, error } = await db()
      .from("posts")
      .select("*, media:post_media(id, kind, position, file_name)")
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", `${addDays(from, -1)}T00:00:00Z`)
      .lte("scheduled_at", `${addDays(to, 1)}T00:00:00Z`)
      .order("scheduled_at");
    if (error) return fail(error.message, 500);

    const byDate: Record<string, unknown[]> = {};
    for (const p of posts ?? []) {
      const local = utcToLocalParts(p.scheduled_at as string, tz);
      if (local.date < from || local.date >= to) continue;
      (byDate[local.date] ??= []).push({ ...p, local_time: local.time, local_date: local.date });
    }

    const openings = (await expandSlots({ from, days })).filter((s) => !s.taken);
    const openByDate: Record<string, typeof openings> = {};
    for (const o of openings) (openByDate[o.local_date] ??= []).push(o);

    return ok({
      timezone: env.timezone,
      from,
      to,
      days,
      today: todayLocal(tz),
      posts_by_date: byDate,
      openings_by_date: openByDate,
    });
  } catch (error) {
    return boom(error, "Building the calendar failed");
  }
}
