import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, checkPassword, createSession, sessionCookieOptions } from "@/lib/auth";
import { env } from "@/lib/env";
import { fail, parseBody } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, z.object({ password: z.string() }));
  if (error) return error;

  if (!checkPassword(data.password, env.appPassword)) {
    // A deliberate pause: this endpoint is the whole front door, and an
    // unthrottled one is worth brute-forcing.
    await new Promise((r) => setTimeout(r, 600));
    return fail("Wrong password", 401);
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSession(env.sessionSecret), sessionCookieOptions);
  return NextResponse.json({ ok: true });
}
