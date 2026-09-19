import { SlotManager } from "@/components/slot-manager";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import type { Slot } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SlotsPage() {
  const { data } = await db()
    .from("slots")
    .select("*")
    .order("day_of_week")
    .order("time_local");

  return <SlotManager initialSlots={(data ?? []) as Slot[]} timezone={env.timezone} />;
}
