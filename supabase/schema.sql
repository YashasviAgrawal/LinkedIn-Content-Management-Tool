-- ============================================================================
-- Cadence webapp — database schema
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: everything is IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type post_status as enum (
    'draft',            -- being written, not ready
    'approved',         -- approved by the user, not on the calendar yet
    'scheduled',        -- has a scheduled_at, the cron will publish it
    'publishing',       -- cron has claimed it (lock state)
    'published',        -- live on LinkedIn
    'failed',           -- publish attempt failed, see last_error
    'manual_required',  -- cannot be automated (polls) — post it by hand
    'archived'          -- retired, kept for history
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type post_type as enum (
    'text',          -- text only
    'image',         -- one image
    'multi_image',   -- 2-20 images (mosaic + swipe viewer)
    'carousel_pdf',  -- native document post, the true swipeable carousel
    'poll',          -- LinkedIn has no poll API — manual
    'article'        -- external link post
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_kind as enum ('image', 'document');
exception when duplicate_object then null; end $$;

-- ── posts ───────────────────────────────────────────────────────────────────
create table if not exists posts (
  id               uuid primary key default gen_random_uuid(),
  title            text        not null,
  slug             text        unique,
  body             text        not null default '',

  status           post_status not null default 'draft',
  post_type        post_type   not null default 'text',

  -- scheduling. scheduled_at is always UTC; the UI renders it in APP_TIMEZONE.
  scheduled_at     timestamptz,
  published_at     timestamptz,
  slot_id          uuid,

  -- editorial metadata, mirrors the draft frontmatter
  pillar           text,
  hook_type        text,
  cta              text,
  audience         text,
  notes            text,
  invented_content text,
  sources          text,
  tags             text[]      not null default '{}',

  -- document-post extras
  doc_title        text,

  -- publishing outcome
  linkedin_post_id text,
  linkedin_url     text,
  media_mode       text,
  last_error       text,
  attempts         int         not null default 0,
  locked_at        timestamptz,

  -- provenance: which draft .md in the repo this came from
  source_path      text,
  created_by       text        not null default 'webapp',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists posts_scheduled_at_idx on posts (scheduled_at);
create index if not exists posts_status_idx       on posts (status);
create index if not exists posts_due_idx          on posts (status, scheduled_at)
  where status in ('scheduled', 'publishing');

-- One post per instant. This is what stops Claude Code and the webapp from
-- double-booking a slot: the database refuses the second writer, rather than
-- a "is it free?" check that raced.
create unique index if not exists posts_unique_scheduled_at
  on posts (scheduled_at)
  where scheduled_at is not null
    and status in ('scheduled', 'publishing', 'published', 'manual_required');

-- ── media ───────────────────────────────────────────────────────────────────
create table if not exists post_media (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references posts(id) on delete cascade,
  kind          media_kind not null default 'image',
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  byte_size     bigint,
  alt_text      text,
  position      int  not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists post_media_post_idx on post_media (post_id, position);

-- ── recurring slot template ─────────────────────────────────────────────────
-- The weekly grid Claude Code asks "which slot is free?" against.
create table if not exists slots (
  id           uuid primary key default gen_random_uuid(),
  day_of_week  int  not null check (day_of_week between 0 and 6), -- 0 = Sunday
  time_local   text not null,   -- 'HH:MM' wall-clock in APP_TIMEZONE
  label        text,
  preferred    text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (day_of_week, time_local)
);

alter table posts drop constraint if exists posts_slot_id_fkey;
alter table posts add constraint posts_slot_id_fkey
  foreign key (slot_id) references slots(id) on delete set null;

-- ── publish attempt log ─────────────────────────────────────────────────────
create table if not exists publish_log (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid references posts(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  ok           boolean not null,
  http_status  int,
  message      text,
  detail       jsonb,
  trigger      text not null default 'cron'
);

create index if not exists publish_log_post_idx on publish_log (post_id, attempted_at desc);

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists posts_touch_updated_at on posts;
create trigger posts_touch_updated_at
  before update on posts
  for each row execute function touch_updated_at();

-- ── storage bucket for images + carousel PDFs ───────────────────────────────
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', false)
on conflict (id) do nothing;

-- ── row level security ──────────────────────────────────────────────────────
-- Every read and write goes through the Next.js server using the service-role
-- key, which bypasses RLS. Enabling RLS with no permissive policy means the
-- anon and publishable keys can read nothing — so one of those leaking is
-- worth nothing on its own.
alter table posts       enable row level security;
alter table post_media  enable row level security;
alter table slots       enable row level security;
alter table publish_log enable row level security;

-- ── claim_due_posts: the atomic lock the scheduler runs on ──────────────────
-- Flips due rows to 'publishing' and hands them back in one statement, so two
-- overlapping cron ticks can never publish the same post twice.
create or replace function claim_due_posts(p_limit int default 5)
returns setof posts as $$
  update posts
     set status    = 'publishing',
         locked_at = now(),
         attempts  = attempts + 1
   where id in (
     select id from posts
      where status = 'scheduled'
        and scheduled_at is not null
        and scheduled_at <= now()
        and attempts < 3
      order by scheduled_at
      limit p_limit
      for update skip locked
   )
  returning *;
$$ language sql;

-- Rows that crashed mid-publish (the worker died after claiming) get unstuck
-- rather than sitting in 'publishing' forever.
create or replace function release_stale_locks(p_minutes int default 15)
returns int as $$
declare n int;
begin
  update posts
     set status = case when attempts >= 3 then 'failed'::post_status
                       else 'scheduled'::post_status end,
         last_error = coalesce(last_error, 'Publish worker stopped mid-run; lock released.')
   where status = 'publishing'
     and locked_at < now() - make_interval(mins => p_minutes);
  get diagnostics n = row_count;
  return n;
end $$ language plpgsql;
