import { boom, fail, guard, ok } from "@/lib/api";
import { publishPost } from "@/lib/publish";
import { db } from "@/lib/supabase";
import type { Post } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/posts/:id/publish — publish now, ignoring the schedule.
 *
 * The status flip to 'publishing' is conditional on the row still being in a
 * publishable state, which is the same lock the cron uses: if the scheduler
 * claimed this post a second ago, this request loses and says so.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;

    const { data: claimed, error } = await db()
      .from("posts")
      .update({ status: "publishing", locked_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["draft", "approved", "scheduled", "failed", "manual_required"])
      .select("*")
      .single();

    if (error || !claimed) {
      const { data: current } = await db()
        .from("posts")
        .select("status")
        .eq("id", id)
        .single();
      if (!current) return fail("Post not found", 404);
      return fail(
        current.status === "published"
          ? "That post is already live."
          : `Cannot publish a post that is ${current.status}.`,
        409,
      );
    }

    const outcome = await publishPost(claimed as Post, "manual");
    return ok(outcome, { status: outcome.ok ? 200 : 502 });
  } catch (error) {
    return boom(error, "Publishing failed");
  }
}
