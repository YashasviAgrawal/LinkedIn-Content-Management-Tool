import { boom, fail, guard, ok, parseBody } from "@/lib/api";
import { slotUpdateSchema } from "@/lib/schemas";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  const { data, error: badBody } = await parseBody(request, slotUpdateSchema);
  if (badBody) return badBody;

  try {
    const { id } = await params;
    const { data: updated, error } = await db()
      .from("slots")
      .update(data)
      .eq("id", id)
      .select("*")
      .single();
    if (error?.code === "23505") return fail("That day and time is already a slot.", 409);
    if (error) return fail(error.message, 500);
    if (!updated) return fail("Slot not found", 404);
    return ok({ slot: updated });
  } catch (error) {
    return boom(error, "Updating the slot failed");
  }
}

/**
 * Deleting a slot template never touches posts already booked on it — the
 * booking lives on posts.scheduled_at, and slot_id is only a back-reference.
 */
export async function DELETE(request: Request, { params }: Params) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const { error } = await db().from("slots").delete().eq("id", id);
    if (error) return fail(error.message, 500);
    return ok({ ok: true });
  } catch (error) {
    return boom(error, "Deleting the slot failed");
  }
}
