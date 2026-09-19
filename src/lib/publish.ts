/**
 * Takes one post row from 'publishing' to a final state.
 *
 * The caller is responsible for claiming the row first (claim_due_posts, or an
 * explicit status flip for a manual publish) — by the time this runs, the row
 * is already locked and nothing else will touch it.
 */

import { env } from "./env";
import { publishDocument, publishShare, type ImageAttachment } from "./linkedin";
import { db, downloadMedia } from "./supabase";
import type { Post, PostMedia } from "./types";

export interface PublishOutcome {
  post_id: string;
  title: string;
  ok: boolean;
  status: Post["status"];
  message: string;
  linkedin_url?: string | null;
  media_mode?: string | null;
}

async function log(
  postId: string,
  ok: boolean,
  message: string,
  trigger: string,
  detail?: unknown,
) {
  await db().from("publish_log").insert({
    post_id: postId,
    ok,
    message: message.slice(0, 4000),
    trigger,
    detail: detail ? JSON.parse(JSON.stringify(detail)) : null,
  });
}

async function mediaFor(postId: string): Promise<PostMedia[]> {
  const { data, error } = await db()
    .from("post_media")
    .select("*")
    .eq("post_id", postId)
    .order("position");
  if (error) throw new Error(`Could not read media: ${error.message}`);
  return (data ?? []) as PostMedia[];
}

export async function publishPost(
  post: Post,
  trigger: "cron" | "manual" | "api" = "cron",
): Promise<PublishOutcome> {
  const finish = async (
    status: Post["status"],
    fields: Partial<Post>,
    message: string,
    ok: boolean,
  ): Promise<PublishOutcome> => {
    await db()
      .from("posts")
      .update({ status, locked_at: null, ...fields })
      .eq("id", post.id);
    await log(post.id, ok, message, trigger);
    return {
      post_id: post.id,
      title: post.title,
      ok,
      status,
      message,
      linkedin_url: (fields.linkedin_url as string) ?? null,
      media_mode: (fields.media_mode as string) ?? null,
    };
  };

  // LinkedIn has no poll-creation API — not a missing scope, the endpoint does
  // not exist for members. Rather than fail, park it where the board can shout.
  if (post.post_type === "poll") {
    return finish(
      "manual_required",
      { last_error: null },
      "Polls cannot be published through the API. Post this one by hand.",
      true,
    );
  }

  if (!post.body.trim()) {
    return finish("failed", { last_error: "Empty post body" }, "Refusing to publish an empty post body.", false);
  }

  try {
    const media = await mediaFor(post.id);

    if (env.dryRun) {
      // Put it back where it came from. The claimed row already says
      // 'publishing', so the only signal left is whether it holds a slot.
      return finish(
        post.scheduled_at ? "scheduled" : "approved",
        { last_error: null, attempts: 0 },
        `DRY RUN — would publish "${post.title}" (${post.post_type}, ${media.length} file(s)). ` +
          "Nothing was sent to LinkedIn. Unset PUBLISH_DRY_RUN to arm it.",
        true,
      );
    }

    // ── document post: the true swipeable carousel ──────────────────────────
    if (post.post_type === "carousel_pdf") {
      const pdf = media.find((m) => m.kind === "document");
      if (!pdf) {
        return finish(
          "failed",
          { last_error: "No PDF attached" },
          "A carousel post needs a PDF attached. Upload one, then reschedule.",
          false,
        );
      }
      const bytes = await downloadMedia(pdf.storage_path);
      const result = await publishDocument(
        post.body,
        bytes,
        post.doc_title || post.title,
      );
      return finish(
        "published",
        {
          published_at: new Date().toISOString(),
          linkedin_url: result.post_url,
          linkedin_post_id: result.post_id,
          media_mode: result.media_mode,
          last_error: null,
        },
        `Published as a document post: ${result.post_url}`,
        true,
      );
    }

    // ── text, one image, or a multi-image mosaic ────────────────────────────
    const images = media.filter((m) => m.kind === "image");
    const attachments: ImageAttachment[] = [];
    for (const image of images) {
      attachments.push({ bytes: await downloadMedia(image.storage_path), alt: image.alt_text });
    }

    let result;
    try {
      result = await publishShare(post.body, attachments);
    } catch (error) {
      // The multi-image shape is the least-exercised path in the chain. A
      // carousel cover card is a complete post on its own, so falling back
      // beats missing the slot — but say so loudly in the log and on the row.
      if (attachments.length <= 1) throw error;
      const why = error instanceof Error ? error.message : String(error);
      await log(post.id, false, `Multi-image rejected, falling back to cover: ${why}`, trigger);
      result = await publishShare(post.body, [attachments[0]]);
      result.media_mode = `FALLBACK — cover image only, ${attachments.length - 1} card(s) not attached`;
    }

    return finish(
      "published",
      {
        published_at: new Date().toISOString(),
        linkedin_url: result.post_url,
        linkedin_post_id: result.post_id,
        media_mode: result.media_mode,
        last_error: null,
      },
      `Published (${result.media_mode}): ${result.post_url}`,
      true,
    );
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    // attempts was already incremented by claim_due_posts. Three strikes and it
    // stops retrying, so a dead token doesn't burn the whole queue. A manual
    // publish never goes back to 'scheduled' — there may be no scheduled_at to
    // retry against, and the person is standing right there to see the error.
    const retryable = trigger === "cron" && post.attempts < 3 && Boolean(post.scheduled_at);
    return finish(
      retryable ? "scheduled" : "failed",
      { last_error: why.slice(0, 4000) },
      retryable
        ? `Attempt ${post.attempts} failed, will retry: ${why}`
        : `Publish failed: ${why}`,
      false,
    );
  }
}
