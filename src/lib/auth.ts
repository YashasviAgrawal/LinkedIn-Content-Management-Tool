/**
 * Two doors into this app, and they are separate on purpose:
 *
 *   1. The browser UI — a password gate that mints a signed, httpOnly session
 *      cookie. One user, one password, no signup flow.
 *   2. The machine API — a bearer token (CADENCE_API_KEY) that Claude Code
 *      sends. Revoking it does not log the browser out, and vice versa.
 *
 * Everything here uses Web Crypto so `middleware.ts` can call it on the edge
 * runtime as well as the Node route handlers.
 */

export const SESSION_COOKIE = "cadence_session";
const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compare without leaking how many leading characters matched. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a cookie value that carries its own expiry. */
export async function createSession(secret: string): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = String(expires);
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(
  token: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!timingSafeEqual(signature, await hmac(secret, payload))) return false;

  const expires = Number(payload);
  return Number.isFinite(expires) && expires > Date.now();
}

export function checkPassword(given: string, expected: string): boolean {
  return timingSafeEqual(given, expected);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
};

/** Pull a bearer token out of `Authorization`, or the `x-api-key` header. */
export function bearerFrom(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-api-key");
}
