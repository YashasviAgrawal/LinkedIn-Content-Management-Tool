import { boom, fail, guard, ok, parseBody } from "@/lib/api";
import { env } from "@/lib/env";
import { mediaMetaSchema } from "@/lib/schemas";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Edit one file's alt text or its place in the carousel. */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  const { data, error: badBody } = await parseBody(request, mediaMetaSchema);
  if (badBody) return badBody;

  try {
    const { id } = await params;
    const { data: updated, error } = await db()
      .from("post_media")
      .update(data)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return fail(error.message, 500);
    if (!updated) return fail("File not found", 404);
    return ok({ media: updated });
  } catch (error) {
    return boom(error, "Updating the file failed");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const { data: row } = await db()
      .from("post_media")
      .select("storage_path")
      .eq("id", id)
      .single();
    if (!row) return fail("File not found", 404);

    await db().storage.from(env.mediaBucket).remove([row.storage_path]);
    const { error } = await db().from("post_media").delete().eq("id", id);
    if (error) return fail(error.message, 500);

    return ok({ ok: true });
  } catch (error) {
    return boom(error, "Deleting the file failed");
  }
}
