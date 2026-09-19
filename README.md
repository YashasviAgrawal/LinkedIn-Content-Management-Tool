# Cadence webapp

The scheduling half of Cadence. Claude Code writes the posts; this holds them,
shows them on a calendar, and publishes them at their slot.

```
Claude Code  ──push──▶  webapp API  ──▶  Supabase (rows + files)
                                            │
                          calendar board ◀──┤
                                            │
                          scheduler tick ───┴──▶  LinkedIn
```

**Stack:** Next.js 15 (App Router) · Supabase Postgres + Storage · Next.js route
handlers · pg_cron.

**Why no FastAPI.** The whole backend here is CRUD plus a publish call. A second
Python service would mean a second deploy, a second set of secrets, CORS, and a
second place for the LinkedIn token to live — for no compute that Next.js can't
do. The publishing logic is ported to TypeScript in `src/lib/linkedin.ts`;
`integrations/linkedin.py` stays as the manual escape hatch.

---

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com) (the free tier is
enough), then in **SQL Editor → New query**:

1. Paste and run [`supabase/schema.sql`](supabase/schema.sql) — tables, the
   storage bucket, RLS, and the atomic claim function.
2. Paste and run [`supabase/seed.sql`](supabase/seed.sql) — the default weekly
   slot grid, taken from `drafts/CONTENT_CALENDAR.md`. Edit it later on `/slots`.

### 2. Environment

```bash
cd webapp
cp .env.example .env.local
```

Fill in:

| Variable | Where it comes from |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `APP_PASSWORD` | You pick it. It is the whole login. |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CADENCE_API_KEY` | Same generator. Claude Code sends this. |
| `CRON_SECRET` | Same generator. The scheduler sends this. |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_PERSON_URN` | Copy from the repo root `.env` |

`PUBLISH_DRY_RUN=true` ships on by default: the scheduler will log what it would
send and post nothing. **Leave it on until you have watched one slot come and go.**

### 3. Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, sign in with `APP_PASSWORD`, and check
<http://localhost:3000/api/health> — it reports which variables are set, whether
the database answers, and whether LinkedIn accepts the token.

### 4. Deploy

```bash
npx vercel
```

Add every variable from `.env.local` in **Vercel → Settings → Environment
Variables**, then redeploy.

### 5. Arm the scheduler

Run [`supabase/pg_cron.sql`](supabase/pg_cron.sql) after filling in your app URL
and `CRON_SECRET`. It ticks every minute.

**Use pg_cron rather than Vercel Cron.** Vercel's Hobby plan runs cron jobs at
most once per day, which cannot hit an 08:45 and a 19:30 slot. `vercel.json`
carries a 5-minute schedule for anyone on Pro, but pg_cron is free and more
precise. Either way the endpoint is the same authenticated call, so a local task
or a GitHub Action works too:

```bash
curl -X POST https://your-app.vercel.app/api/cron/publish -H "Authorization: Bearer $CRON_SECRET"
```

---

## Connect Claude Code

Add to the **repo root** `.env`:

```
CADENCE_APP_URL=https://your-app.vercel.app
CADENCE_API_KEY=<the same value as in the webapp>
```

Then, from the repo root:

```bash
# what's open
python scripts/cadence_push.py --free-slots 6

# push an approved draft into the next free slot
python scripts/cadence_push.py --draft drafts/2026-09/2026-09-21_name-the-person.md --slot next

# a real swipeable carousel
python scripts/cadence_push.py --draft drafts/2026-09/2026-09-22_am_nine-boring-tools-carousel.md \
  --document drafts/2026-09/images/carousel-2026-09-22/carousel-nine-tool-stack.pdf \
  --doc-title "9 boring tools" --slot next

# an exact time instead of the next opening
python scripts/cadence_push.py --draft d.md --image card.png --image-alt "…" --at "2026-09-22 19:30"
```

Add `--dry-run` to any of them to see the exact payload without sending it.

The script reads the draft's frontmatter (`topic`, `pillar`, `hook_type`, `cta`,
`invented_content`, …) and carries it across, so the webapp shows the same
context the pipeline had — including the "check this before posting" warning.
It applies the same `<!-- POST -->` rule as `publish_post.py`, so both paths
always agree on what the publishable body is.

---

## How slots work

`slots` is a **weekly template** — day of week plus wall-clock time. It is not a
list of dates. The app projects it forward onto real dates and subtracts what is
already booked; whatever is left is free.

```
GET /api/slots/free?count=5
```

```json
{
  "timezone": "Asia/Kolkata",
  "free": [
    { "scheduled_at": "2026-09-22T03:15:00.000Z",
      "label_human": "Tue 22 Sep, 08:45",
      "preferred": "tools list, carousel" }
  ],
  "summary": { "slots_in_window": 26, "free_in_window": 19, "taken_in_window": 7 }
}
```

**Double-booking is prevented in the database, not in application code.** A
partial unique index on `posts.scheduled_at` covers every status that holds a
slot, so when Claude Code and the calendar both reach for the same opening,
Postgres refuses the second one and the API returns a 409 naming the post that
already has it. A "check then write" would have raced.

---

## What the scheduler does

Every tick calls `claim_due_posts()`, which flips due rows to `publishing` **in
the same statement that returns them**. Two overlapping ticks cannot pick up the
same post. Then, per post:

| Format | What goes out |
|---|---|
| `text` | Plain share |
| `image` / `multi_image` | `ugcPosts` with the images and their alt text |
| `carousel_pdf` | `/rest/posts` document post — the real swipeable carousel |
| `poll` | Nothing. LinkedIn has no poll API, so it is flagged **post by hand** on the board |

A multi-image post that LinkedIn rejects falls back to the cover card alone and
says so in `media_mode` — a cover card is a complete post, so the slot is never
missed over it. Failures retry twice, then stop at `failed` with the error on
the row, so a dead token cannot burn the whole queue.

If a worker dies mid-publish, `release_stale_locks()` (also on pg_cron) puts the
row back after 15 minutes rather than leaving it stuck in `publishing`.

---

## API

Everything under `/api` takes `Authorization: Bearer $CADENCE_API_KEY` **or** a
browser session cookie.

| Method | Path | What |
|---|---|---|
| `GET` | `/api/posts` | List. `?status=&from=&to=&q=&limit=` |
| `POST` | `/api/posts` | Create; accepts `slot:"next"` to book in the same call |
| `GET/PATCH/DELETE` | `/api/posts/:id` | Read, edit, delete (removes its files too) |
| `GET/POST` | `/api/posts/:id/media` | List / upload (multipart, field `file`, repeat for many) |
| `POST/DELETE` | `/api/posts/:id/schedule` | Book / unbook |
| `POST` | `/api/posts/:id/publish` | Publish now, ignoring the schedule |
| `PATCH/DELETE` | `/api/media/:id` | Alt text, order, delete |
| `GET/POST` | `/api/slots` | The weekly template |
| `PATCH/DELETE` | `/api/slots/:id` | Edit / remove a slot |
| `GET` | `/api/slots/free` | **The openings.** `?count=&after=&days=&all=1` |
| `GET` | `/api/calendar` | Board data. `?from=YYYY-MM-DD&days=42` |
| `GET` | `/api/health` | Config, database, LinkedIn token |
| `POST` | `/api/cron/publish` | The scheduler tick — `CRON_SECRET` only |

Scheduling takes any of three shapes:

```jsonc
{ "slot": "next" }                                     // earliest opening
{ "slot": "next", "after": "2026-10-01" }              // earliest from a date
{ "local_date": "2026-09-22", "local_time": "08:45" }  // wall clock, APP_TIMEZONE
{ "scheduled_at": "2026-09-22T03:15:00Z" }             // explicit instant
```

Add `"force": true` to take an occupied slot; the sitting post is bumped back to
`approved`, not deleted.

---

## Security notes

- The service-role key is server-only. No `NEXT_PUBLIC_` variable in this app
  carries a secret.
- RLS is on for every table with no permissive policy, so the anon key reads
  nothing even if it leaks. All access goes through the server.
- The media bucket is private; the UI renders through short-lived signed URLs.
- `CADENCE_API_KEY` and `CRON_SECRET` are separate on purpose — a leaked
  publishing token should not also be able to read and edit every draft.
- The password gate lives in `middleware.ts` and covers pages only; API routes
  check both doors themselves in `guard()`.

Single user, one password. If this ever needs real accounts, swap the middleware
for Supabase Auth and replace `guard()` with a JWT check — the table shapes do
not change.

---

## Status meanings

| Status | Meaning |
|---|---|
| `draft` | Being written. Holds no slot. |
| `approved` | Ready, waiting for a slot. Shows in the calendar's side tray. |
| `scheduled` | On the calendar. The scheduler will publish it. |
| `publishing` | Claimed by the scheduler right now. |
| `published` | Live, with `linkedin_url` on the row. |
| `failed` | Three attempts used up. `last_error` says why. |
| `manual_required` | A poll that came due. Post it by hand. |
| `archived` | Retired, kept for history. |
