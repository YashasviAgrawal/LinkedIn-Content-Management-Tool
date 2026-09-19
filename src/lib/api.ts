import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, bearerFrom, verifySession } from "./auth";
import { env } from "./env";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Accept the request if it carries either a valid browser session or the API
 * key. Route handlers call this first and return the response when it is
 * non-null.
 */
export async function guard(request: Request): Promise<NextResponse | null> {
  const token = bearerFrom(request);
  if (token && token === process.env.CADENCE_API_KEY) return null;

  const jar = await cookies();
  if (await verifySession(jar.get(SESSION_COOKIE)?.value, env.sessionSecret)) return null;

  return fail("Unauthorized", 401);
}

/** The scheduler's own door — only CRON_SECRET opens it. */
export function guardCron(request: Request): NextResponse | null {
  const token = bearerFrom(request);
  if (token && token === process.env.CRON_SECRET) return null;

  // Vercel Cron signs its own requests with this header when the project has
  // CRON_SECRET set, so both trigger styles work from one endpoint.
  if (request.headers.get("x-vercel-cron")) return null;

  return fail("Unauthorized", 401);
}

/** Parse a JSON body against a schema, returning a 422 with field paths on failure. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S>; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { data: null, error: fail("Body must be valid JSON", 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      data: null,
      error: fail("Validation failed", 422, {
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join(".") || "(root)",
          message: i.message,
        })),
      }),
    };
  }
  return { data: parsed.data, error: null };
}

/** Turn a thrown error into a 500 whose body says what actually broke. */
export function boom(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[cadence] ${context}:`, error);
  return fail(`${context}: ${message}`, 500);
}
