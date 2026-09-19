import { boom, fail, guard, ok, parseBody } from "@/lib/api";
import { env } from "@/lib/env";
import { postUpdateSchema } from "@/lib/schemas";
import { isSlotConflict, resolveScheduleTime } from "@/lib/scheduling";
import { instantTakenBy } from "@/lib/slots";
import { db, signedUrl } from "@/lib/supabase";
import { formatSlotLabel } from "@/lib/time";
import type { PostMedia } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const { data, error } = await db()
      .from("posts")
      .select("*, media:post_media(*)")
      .eq("id", id)
      .single();

    if (error || !data) return fail("Post not found", 404);

    // Media rows carry a storage path, not a URL — mint short-lived signed ones
    // so the bucket can stay private.
    const media = ((data.media ?? []) as PostMedia[]).sort((a, b) => a.position - b.position);
    for (const m of media) m.url = await signedUrl(m.storage_path);

    const { data: logs } = await db()
      .from("publish_log")
      .select("*")
      .eq("post_id", id)
      .order("attempted_at", { ascending: false })
      .limit(20);

    return ok({ post: { ...data, media }, log: logs ?? [], timezone: env.timezone });
  } catch (error) {
    return boom(error, "Reading the post failed");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  const { data, error: badBody } = await parseBody(request, postUpdateSchema);
  if (badBody) return badBody;

  try {
    const { id } = await params;
    const { slot, local_date, local_time, scheduled_at, ...fields } = data;
    const patch: Record<string, unknown> = { ...fields };

    // `scheduled_at: null` is a real instruction — it clears the booking —
    // so presence in the body matters, not truthiness.
    const clearing = "scheduled_at" in data && scheduled_at === null;
    const rescheduling = Boolean(slot || scheduled_at || (local_date && local_time));

    if (clearing) {
      patch.scheduled_at = null;
      patch.slot_id = null;
      if (!fields.status) patch.status = "approved";
    } else if (rescheduling) {
      const resolved = await resolveScheduleTime({ slot, local_date, local_time, scheduled_at });
      const clash = await instantTakenBy(resolved.instant.toISOString(), id);
      if (clash) {
        return fail(
          `${formatSlotLabel(resolved.instant, env.timezone)} is already taken by "${clash.title}".`,
          409,
          { conflict: clash },
        );
      }
      patch.scheduled_at = resolved.instant.toISOString();
      patch.slot_id = resolved.slotId;
      if (!fields.status) patch.status = "scheduled";
    }

    if (Object.keys(patch).length === 0) return fail("Nothing to update", 400);

    const { data: updated, error } = await db()
      .from("posts")
      .update(patch)
      .eq("id", id)
      .select("*, media:post_media(*)")
      .single();

    if (isSlotConflict(error)) {
      return fail("That slot was taken while this request was in flight.", 409);
    }
    if (error) return fail(error.message, 500);
    if (!updated) return fail("Post not found", 404);

    return ok({ post: updated });
  } catch (error) {
    return boom(error, "Updating the post failed");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;

    const { data: post } = await db()
      .from("posts")
      .select("id, status")
      .eq("id", id)
      .single();
    if (!post) return fail("Post not found", 404);
    if (post.status === "publishing") {
      return fail("This post is mid-publish. Wait for it to settle before deleting.", 409);
    }

    // Storage has no cascade, so the files go first — otherwise the bucket
    // silently fills with orphans nothing references.
    const { data: media } = await db()
      .from("post_media")
      .select("storage_path")
      .eq("post_id", id);
    const paths = (media ?? []).map((m) => m.storage_path);
    if (paths.length) await db().storage.from(env.mediaBucket).remove(paths);

    const { error } = await db().from("posts").delete().eq("id", id);
    if (error) return fail(error.message, 500);

    return ok({ ok: true, deleted_files: paths.length });
  } catch (error) {
    return boom(error, "Deleting the post failed");
  }
}
