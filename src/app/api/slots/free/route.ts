import { boom, guard, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { expandSlots } from "@/lib/slots";
import { formatSlotLabel } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/slots/free — the openings on the calendar.
 *
 * This is the endpoint Claude Code calls before it writes anything, so it can
 * see how many slots need filling and what each one is for.
 *
 *   ?count=5      how many free slots to return  (default 10)
 *   ?after=DATE   earliest local date to consider ('YYYY-MM-DD')
 *   ?days=60      how far forward to project     (default 60)
 *   ?all=1        include taken slots too, in order, for a full picture
 */
export async function GET(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const count = Math.min(Number(url.searchParams.get("count") ?? 10), 100);
    const days = Math.min(Number(url.searchParams.get("days") ?? 60), 365);
    const after = url.searchParams.get("after") ?? undefined;
    const includeTaken = url.searchParams.get("all") === "1";

    const all = await expandSlots({ from: after, days });
    const chosen = (includeTaken ? all : all.filter((s) => !s.taken)).slice(0, count);

    return ok({
      timezone: env.timezone,
      free: chosen.map((s) => ({
        ...s,
        label_human: formatSlotLabel(s.scheduled_at, env.timezone),
      })),
      summary: {
        window_days: days,
        slots_in_window: all.length,
        free_in_window: all.filter((s) => !s.taken).length,
        taken_in_window: all.filter((s) => s.taken).length,
      },
    });
  } catch (error) {
    return boom(error, "Reading free slots failed");
  }
}
