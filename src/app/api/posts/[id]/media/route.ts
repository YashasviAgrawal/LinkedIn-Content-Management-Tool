import { boom, fail, guard, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { db, signedUrl } from "@/lib/supabase";
import type { MediaKind, PostMedia, PostType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);
const MAX_BYTES = 20 * 1024 * 1024; // LinkedIn's own ceiling is lower; this catches accidents.

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export async function GET(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const { data, error } = await db()
      .from("post_media")
      .select("*")
      .eq("post_id", id)
      .order("position");
    if (error) return fail(error.message, 500);

    const media = (data ?? []) as PostMedia[];
    for (const m of media) m.url = await signedUrl(m.storage_path);
    return ok({ media });
  } catch (error) {
    return boom(error, "Listing media failed");
  }
}

/**
 * POST /api/posts/:id/media — multipart upload.
 *
 * Fields:
 *   file      one or more files, in carousel order
 *   alt       alt texts, positionally matched to the files
 *   position  optional integer to start numbering from
 *
 * Carousel order is filename order on the client side; here it is the order
 * the parts arrive in, which is what the agent controls when it sorts its
 * paths before sending.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;

    const { data: post } = await db()
      .from("posts")
      .select("id, post_type")
      .eq("id", id)
      .single();
    if (!post) return fail("Post not found", 404);

    const form = await request.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) return fail("No files in the request (field name: 'file')", 400);

    const alts = form.getAll("alt").map((a) => String(a));

    const { data: existing } = await db()
      .from("post_media")
      .select("position")
      .eq("post_id", id)
      .order("position", { ascending: false })
      .limit(1);
    let position = Number(form.get("position") ?? (existing?.[0]?.position ?? -1) + 1);

    const created: PostMedia[] = [];
    let images = 0;
    let documents = 0;

    for (const [i, file] of files.entries()) {
      if (file.size > MAX_BYTES) {
        return fail(`${file.name} is ${(file.size / 1e6).toFixed(1)} MB — over the 20 MB limit.`, 413);
      }

      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const isImage = IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      if (!isPdf && !isImage) {
        return fail(`${file.name} is neither an image nor a PDF (${file.type || "unknown type"}).`, 415);
      }

      const kind: MediaKind = isPdf ? "document" : "image";
      isPdf ? documents++ : images++;

      const path = `posts/${id}/${String(position).padStart(3, "0")}-${safeName(file.name)}`;
      const bytes = Buffer.from(await file.arrayBuffer());

      const { error: upErr } = await db()
        .storage.from(env.mediaBucket)
        .upload(path, bytes, {
          contentType: file.type || (isPdf ? "application/pdf" : "application/octet-stream"),
          upsert: true,
        });
      if (upErr) return fail(`Upload of ${file.name} failed: ${upErr.message}`, 500);

      const { data: row, error: rowErr } = await db()
        .from("post_media")
        .insert({
          post_id: id,
          kind,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          byte_size: file.size,
          alt_text: alts[i] ?? null,
          position,
        })
        .select("*")
        .single();
      if (rowErr) return fail(rowErr.message, 500);

      row.url = await signedUrl(path);
      created.push(row as PostMedia);
      position++;
    }

    // Save the caller from having to state the obvious: a PDF means a document
    // post, several images mean a mosaic. Only ever upgrades from the default.
    let newType: PostType | null = null;
    if (post.post_type === "text") {
      if (documents > 0) newType = "carousel_pdf";
      else if (images > 1) newType = "multi_image";
      else if (images === 1) newType = "image";
    }
    if (newType) await db().from("posts").update({ post_type: newType }).eq("id", id);

    return ok({ media: created, post_type: newType ?? post.post_type }, { status: 201 });
  } catch (error) {
    return boom(error, "Uploading media failed");
  }
}
