/**
 * Environment access, with failures that name the missing variable instead of
 * surfacing as `undefined` three layers down.
 */

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get supabaseUrl() {
    return need("SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return need("SUPABASE_SERVICE_ROLE_KEY");
  },

  /** Password for the web UI. */
  get appPassword() {
    return need("APP_PASSWORD");
  },
  /** Signs the session cookie. Any long random string. */
  get sessionSecret() {
    return need("SESSION_SECRET");
  },
  /** Bearer token Claude Code uses on /api/*. */
  get apiKey() {
    return need("CADENCE_API_KEY");
  },
  /** Bearer token the scheduler uses on /api/cron/*. */
  get cronSecret() {
    return need("CRON_SECRET");
  },

  get linkedinToken() {
    return need("LINKEDIN_ACCESS_TOKEN");
  },
  get linkedinPersonUrn() {
    return need("LINKEDIN_PERSON_URN");
  },

  /** Wall-clock timezone every slot and calendar cell is expressed in. */
  get timezone() {
    return opt("APP_TIMEZONE", "Asia/Kolkata");
  },
  /** When true the publisher logs what it would send and posts nothing. */
  get dryRun() {
    return opt("PUBLISH_DRY_RUN", "false").toLowerCase() === "true";
  },
  get mediaBucket() {
    return opt("SUPABASE_MEDIA_BUCKET", "post-media");
  },
} as const;

export const MEDIA_BUCKET = () => env.mediaBucket;
