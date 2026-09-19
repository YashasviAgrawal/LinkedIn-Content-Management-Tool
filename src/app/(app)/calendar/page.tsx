import { CalendarBoard } from "@/components/calendar-board";
import { env } from "@/lib/env";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return <CalendarBoard initialDate={todayLocal(env.timezone)} timezone={env.timezone} />;
}
