import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so it must never be imported into a
 * component that ships to the browser — every caller here is a route handler
 * or a server component.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** A signed URL the browser can render media from, or null if it can't be made. */
export async function signedUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await db().storage
    .from(env.mediaBucket)
    .createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Raw bytes for a stored file — what the LinkedIn uploader needs. */
export async function downloadMedia(path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(env.mediaBucket).download(path);
  if (error || !data) {
    throw new Error(`Could not read ${path} from storage: ${error?.message ?? "not found"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}
