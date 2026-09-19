import { boom, fail, guard, ok, parseBody } from "@/lib/api";
import { env } from "@/lib/env";
import { scheduleSchema } from "@/lib/schemas";
import { NoFreeSlotError, isSlotConflict, resolveScheduleTime } from "@/lib/scheduling";
import { instantTakenBy } from "@/lib/slots";
import { db } from "@/lib/supabase";
import { formatSlotLabel } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/posts/:id/schedule — put a post on the calendar.
 *
 * Body is any one of:
 *   { "slot": "next" }                                  earliest free opening
 *   { "slot": "next", "after": "2026-10-01" }           earliest free from a date
 *   { "local_date": "2026-09-22", "local_time": "08:45" }
 *   { "scheduled_at": "2026-09-22T03:15:00Z" }
 *
 * Add "force": true to take an occupied slot — the sitting post is bumped back
 * to `approved` rather than deleted.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  const { data, error: badBody } = await parseBody(request, scheduleSchema);
  if (badBody) return badBody;

  try {
    const { id } = await params;

    const { data: post } = await db()
      .from("posts")
      .select("id, title, status")
      .eq("id", id)
      .single();
    if (!post) return fail("Post not found", 404);
    if (post.status === "published") {
      return fail("That post is already live. Duplicate it instead of rescheduling.", 409);
    }
    if (post.status === "publishing") {
      return fail("That post is mid-publish. Wait for it to settle.", 409);
    }

    const resolved = await resolveScheduleTime(data);
    const isoInstant = resolved.instant.toISOString();
    const whenLabel = formatSlotLabel(resolved.instant, env.timezone);

    const clash = await instantTakenBy(isoInstant, id);
    if (clash) {
      if (!data.force) {
        return fail(`${whenLabel} is already taken by "${clash.title}".`, 409, {
          conflict: clash,
          scheduled_at: isoInstant,
          hint: "Pass force:true to bump it, or slot:'next' to take the following opening.",
        });
      }
      // Clear the sitting post first — the unique index would reject the swap
      // if both rows held the instant at the same moment.
      await db()
        .from("posts")
        .update({ status: "approved", scheduled_at: null, slot_id: null })
        .eq("id", clash.id);
    }

    const { data: updated, error } = await db()
      .from("posts")
      .update({
        scheduled_at: isoInstant,
        slot_id: resolved.slotId,
        status: "scheduled",
        attempts: 0,
        last_error: null,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (isSlotConflict(error)) {
      return fail("That slot was taken while this request was in flight.", 409);
    }
    if (error) return fail(error.message, 500);

    return ok({
      post: updated,
      scheduled_for: { utc: isoInstant, local: whenLabel },
      bumped: clash && data.force ? clash : null,
    });
  } catch (error) {
    if (error instanceof NoFreeSlotError) return fail(error.message, 409);
    return boom(error, "Scheduling failed");
  }
}

/** DELETE — take it off the calendar, keep the post. */
export async function DELETE(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const { data: updated, error } = await db()
      .from("posts")
      .update({ scheduled_at: null, slot_id: null, status: "approved" })
      .eq("id", id)
      .not("status", "in", "(published,publishing)")
      .select("*")
      .single();

    if (error) return fail(error.message, 500);
    if (!updated) return fail("Post not found, or it is already live / mid-publish.", 409);
    return ok({ post: updated });
  } catch (error) {
    return boom(error, "Unscheduling failed");
  }
}
