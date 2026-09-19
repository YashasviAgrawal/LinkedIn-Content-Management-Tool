import { NextResponse } from "next/server";
import { guard } from "@/lib/api";
import { checkCredentials } from "@/lib/linkedin";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — what is configured, what is reachable, what is queued.
 * Worth hitting once right after deploying, before trusting the first slot.
 */
export async function GET(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  const report: Record<string, unknown> = {
    timezone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
    dry_run: (process.env.PUBLISH_DRY_RUN ?? "false").toLowerCase() === "true",
    env: {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      APP_PASSWORD: Boolean(process.env.APP_PASSWORD),
      SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
      CADENCE_API_KEY: Boolean(process.env.CADENCE_API_KEY),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
      LINKEDIN_ACCESS_TOKEN: Boolean(process.env.LINKEDIN_ACCESS_TOKEN),
      LINKEDIN_PERSON_URN: Boolean(process.env.LINKEDIN_PERSON_URN),
    },
  };

  try {
    const { count, error } = await db()
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled");
    report.database = error ? { ok: false, detail: error.message } : { ok: true, scheduled: count };
  } catch (error) {
    report.database = { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  if (process.env.LINKEDIN_ACCESS_TOKEN) {
    report.linkedin = await checkCredentials();
  } else {
    report.linkedin = { ok: false, detail: "LINKEDIN_ACCESS_TOKEN is not set." };
  }

  const dbOk = (report.database as { ok: boolean }).ok;
  return NextResponse.json(report, { status: dbOk ? 200 : 503 });
}
