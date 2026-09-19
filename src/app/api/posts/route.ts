import { boom, fail, guard, ok, parseBody } from "@/lib/api";
import { postCreateSchema } from "@/lib/schemas";
import { NoFreeSlotError, isSlotConflict, isSlugConflict, resolveScheduleTime } from "@/lib/scheduling";
import { instantTakenBy } from "@/lib/slots";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { formatSlotLabel } from "@/lib/time";
import { POST_STATUSES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** GET /api/posts — list, with optional status / window / search filters. */
export async function GET(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.getAll("status");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);

    let query = db()
      .from("posts")
      .select("*, media:post_media(*)")
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    const valid = status.filter((s) => (POST_STATUSES as readonly string[]).includes(s));
    if (valid.length) query = query.in("status", valid);
    if (from) query = query.gte("scheduled_at", from);
    if (to) query = query.lte("scheduled_at", to);
    if (q) query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return fail(error.message, 500);

    return ok({ posts: data ?? [], timezone: env.timezone });
  } catch (error) {
    return boom(error, "Listing posts failed");
  }
}

/**
 * POST /api/posts — create a post, and optionally book it in the same call.
 *
 * This is the endpoint Claude Code posts to. Passing `slot: "next"` makes the
 * server pick the earliest free opening, so the agent never has to reason
 * about the grid.
 */
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  const { data, error: badBody } = await parseBody(request, postCreateSchema);
  if (badBody) return badBody;

  try {
    const { slot, local_date, local_time, scheduled_at, ...fields } = data;
    const wantsSchedule = Boolean(slot || scheduled_at || (local_date && local_time));

    let instant: Date | null = null;
    let slotId: string | null = null;

    if (wantsSchedule) {
      const resolved = await resolveScheduleTime({ slot, local_date, local_time, scheduled_at });
      instant = resolved.instant;
      slotId = resolved.slotId;

      const clash = await instantTakenBy(instant.toISOString());
      if (clash) {
        return fail(
          `${formatSlotLabel(instant, env.timezone)} is already taken by "${clash.title}".`,
          409,
          { conflict: clash, scheduled_at: instant.toISOString() },
        );
      }
    }

    // A post only holds a slot once it is at least scheduled. Creating with a
    // time but leaving status 'draft' would make the calendar lie.
    const status =
      wantsSchedule && (fields.status === "draft" || fields.status === "approved")
        ? "scheduled"
        : fields.status;

    const row = {
      ...fields,
      status,
      slug: fields.slug || slugify(fields.title),
      scheduled_at: instant?.toISOString() ?? null,
      slot_id: slotId,
    };

    let { data: created, error } = await db()
      .from("posts")
      .insert(row)
      .select("*, media:post_media(*)")
      .single();

    // Two posts can legitimately share a title — a weekly series, a rewrite.
    // The slug is only a handle, so make it unique and carry on rather than
    // making the caller rename their post.
    if (isSlugConflict(error)) {
      ({ data: created, error } = await db()
        .from("posts")
        .insert({ ...row, slug: `${row.slug}-${Date.now().toString(36).slice(-4)}` })
        .select("*, media:post_media(*)")
        .single());
    }

    if (isSlotConflict(error)) {
      return fail("That slot was taken while this request was in flight. Try again.", 409);
    }
    if (error) return fail(error.message, 500);

    return ok(
      {
        post: created,
        scheduled_for: instant
          ? { utc: instant.toISOString(), local: formatSlotLabel(instant, env.timezone) }
          : null,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof NoFreeSlotError) return fail(error.message, 409);
    return boom(error, "Creating the post failed");
  }
}
