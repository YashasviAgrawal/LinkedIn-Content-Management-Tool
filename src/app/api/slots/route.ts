import { boom, fail, guard, ok, parseBody } from "@/lib/api";
import { env } from "@/lib/env";
import { slotSchema } from "@/lib/schemas";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { data, error } = await db()
      .from("slots")
      .select("*")
      .order("day_of_week")
      .order("time_local");
    if (error) return fail(error.message, 500);
    return ok({ slots: data ?? [], timezone: env.timezone });
  } catch (error) {
    return boom(error, "Listing slots failed");
  }
}

export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  const { data, error: badBody } = await parseBody(request, slotSchema);
  if (badBody) return badBody;

  try {
    const { data: created, error } = await db()
      .from("slots")
      .insert(data)
      .select("*")
      .single();
    if (error?.code === "23505") {
      return fail("That day and time is already a slot.", 409);
    }
    if (error) return fail(error.message, 500);
    return ok({ slot: created }, { status: 201 });
  } catch (error) {
    return boom(error, "Creating the slot failed");
  }
}
