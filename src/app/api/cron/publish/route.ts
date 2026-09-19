import { boom, guardCron, ok } from "@/lib/api";
import { publishPost } from "@/lib/publish";
import { db } from "@/lib/supabase";
import type { Post } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The scheduler tick. Point pg_cron, Vercel Cron, GitHub Actions or a local
 * task at it — whichever you use, it is the same authenticated HTTP call:
 *
 *   curl -X POST https://your-app/api/cron/publish -H "Authorization: Bearer $CRON_SECRET"
 *
 * Nothing due is the common case and costs one query.
 *
 * Double-publishing is prevented in the database, not here: claim_due_posts
 * flips the rows to 'publishing' in the same statement that returns them, so
 * two overlapping ticks cannot both pick up the same post.
 */
async function tick() {
  const { data: claimed, error } = await db().rpc("claim_due_posts", { p_limit: 5 });
  if (error) throw new Error(`Claiming due posts failed: ${error.message}`);

  const posts = (claimed ?? []) as Post[];
  if (posts.length === 0) return { published: 0, results: [], checked_at: new Date().toISOString() };

  // Serial, not parallel: LinkedIn rate-limits uploads, and two posts landing
  // in the same second reads as a bot on the feed.
  const results = [];
  for (const post of posts) {
    results.push(await publishPost(post, "cron"));
  }

  return {
    published: results.filter((r) => r.ok && r.status === "published").length,
    results,
    checked_at: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const denied = guardCron(request);
  if (denied) return denied;
  try {
    return ok(await tick());
  } catch (error) {
    return boom(error, "Scheduler tick failed");
  }
}

/** Vercel Cron issues GETs, so both verbs run the same tick. */
export async function GET(request: Request) {
  return POST(request);
}
