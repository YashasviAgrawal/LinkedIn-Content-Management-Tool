"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { STATUS_META, TYPE_LABEL, type Post, type PostStatus, type SlotOccurrence } from "@/lib/types";
import { DAY_SHORT, addDays, weekdayOf } from "@/lib/time";

/** The calendar query selects only the media columns the chips need. */
interface CalendarPost extends Omit<Post, "media"> {
  local_time: string;
  local_date: string;
  media?: { id: string; kind: string; position: number; file_name: string }[];
}

interface CalendarPayload {
  timezone: string;
  from: string;
  today: string;
  posts_by_date: Record<string, CalendarPost[]>;
  openings_by_date: Record<string, SlotOccurrence[]>;
}

type View = "month" | "week";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The Sunday on or before a 'YYYY-MM-DD'. */
function weekStart(date: string): string {
  return addDays(date, -weekdayOf(date));
}

function monthGridStart(anchor: string): string {
  const first = `${anchor.slice(0, 7)}-01`;
  return weekStart(first);
}

function monthLabel(anchor: string): string {
  const [y, m] = anchor.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function rangeLabel(start: string, days: number): string {
  const end = addDays(start, days - 1);
  const fmt = (d: string) => {
    const [, m, day] = d.split("-").map(Number);
    return `${day} ${MONTHS[m - 1].slice(0, 3)}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export function CalendarBoard({ initialDate, timezone }: { initialDate: string; timezone: string }) {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(initialDate);
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [unscheduled, setUnscheduled] = useState<Post[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);

  const gridStart = view === "month" ? monthGridStart(anchor) : weekStart(anchor);
  const gridDays = view === "month" ? 42 : 7;

  const load = useCallback(async () => {
    const [calendar, posts] = await Promise.all([
      fetch(`/api/calendar?from=${gridStart}&days=${gridDays}`).then((r) => r.json()),
      fetch("/api/posts?status=draft&status=approved&status=failed&limit=100").then((r) => r.json()),
    ]);
    if (!calendar.error) setData(calendar);
    if (!posts.error) {
      setUnscheduled((posts.posts as Post[]).filter((p) => !p.scheduled_at));
    }
  }, [gridStart, gridDays]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const days = useMemo(
    () => Array.from({ length: gridDays }, (_, i) => addDays(gridStart, i)),
    [gridStart, gridDays],
  );

  const currentMonth = anchor.slice(0, 7);

  /** Drop a post onto a slot: one PATCH, then reload the board. */
  async function assign(postId: string, scheduledAt: string, force = false) {
    setBusy(true);
    const response = await fetch(`/api/posts/${postId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_at: scheduledAt, force }),
    });
    const body = await response.json();
    setBusy(false);

    if (response.ok) {
      setMessage({ text: `Scheduled for ${body.scheduled_for.local}.` });
      await load();
    } else {
      setMessage({ text: body.error ?? "Could not schedule that.", bad: true });
    }
  }

  async function unschedule(postId: string) {
    setBusy(true);
    const response = await fetch(`/api/posts/${postId}/schedule`, { method: "DELETE" });
    setBusy(false);
    if (response.ok) {
      setMessage({ text: "Taken off the calendar." });
      await load();
    } else {
      const body = await response.json().catch(() => ({}));
      setMessage({ text: body.error ?? "Could not unschedule that.", bad: true });
    }
  }

  function step(direction: 1 | -1) {
    setAnchor(view === "month" ? shiftMonth(anchor, direction) : addDays(anchor, direction * 7));
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">
            {view === "month" ? monthLabel(anchor) : rangeLabel(gridStart, 7)}
          </h1>

          <div className="flex items-center gap-1">
            <button className="btn-ghost" onClick={() => step(-1)} aria-label="Previous">
              ←
            </button>
            <button className="btn-ghost" onClick={() => setAnchor(initialDate)}>
              Today
            </button>
            <button className="btn-ghost" onClick={() => step(1)} aria-label="Next">
              →
            </button>
          </div>

          <div className="ml-auto flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-0.5">
            {(["month", "week"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm capitalize transition-colors ${
                  view === v ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <Link href="/posts/new" className="btn-primary">
            New post
          </Link>
        </div>

        {message && (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              message.bad
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200">
          {DAY_SHORT.map((d) => (
            <div key={d} className="bg-neutral-50 px-2 py-1.5 text-center text-xs font-medium text-neutral-500">
              {d}
            </div>
          ))}

          {days.map((date) => {
            const posts = data?.posts_by_date[date] ?? [];
            const openings = data?.openings_by_date[date] ?? [];
            const isToday = date === data?.today;
            const outsideMonth = view === "month" && date.slice(0, 7) !== currentMonth;

            return (
              <div
                key={date}
                className={`min-h-[7.5rem] bg-white p-1.5 ${outsideMonth ? "opacity-40" : ""} ${
                  view === "week" ? "min-h-[18rem]" : ""
                }`}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span
                    className={`text-xs font-medium ${
                      isToday
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white"
                        : "text-neutral-400"
                    }`}
                  >
                    {Number(date.slice(8))}
                  </span>
                  {posts.length > 0 && (
                    <span className="text-[10px] text-neutral-400">{posts.length}</span>
                  )}
                </div>

                <div className="space-y-1">
                  {posts.map((post) => (
                    <PostChip
                      key={post.id}
                      post={post}
                      onDragStart={() => setDragging(post.id)}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      onUnschedule={() => unschedule(post.id)}
                    />
                  ))}

                  {openings.map((opening) => (
                    <SlotTarget
                      key={opening.scheduled_at}
                      opening={opening}
                      armed={Boolean(dragging)}
                      over={dropTarget === opening.scheduled_at}
                      busy={busy}
                      onOver={() => setDropTarget(opening.scheduled_at)}
                      onLeave={() => setDropTarget((t) => (t === opening.scheduled_at ? null : t))}
                      onDrop={() => {
                        if (dragging) assign(dragging, opening.scheduled_at);
                        setDragging(null);
                        setDropTarget(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Legend />
      </div>

      <UnscheduledTray
        posts={unscheduled}
        onDragStart={setDragging}
        onDragEnd={() => {
          setDragging(null);
          setDropTarget(null);
        }}
        timezone={timezone}
      />
    </div>
  );
}

function shiftMonth(anchor: string, direction: number): string {
  const [y, m] = anchor.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + direction, 1));
  return d.toISOString().slice(0, 10);
}

function PostChip({
  post,
  onDragStart,
  onDragEnd,
  onUnschedule,
}: {
  post: CalendarPost;
  onDragStart: () => void;
  onDragEnd: () => void;
  onUnschedule: () => void;
}) {
  const meta = STATUS_META[post.status as PostStatus];
  // A live post is history — dragging it somewhere else would say something
  // untrue about when it went out.
  const movable = post.status !== "published" && post.status !== "publishing";
  const mediaCount = post.media?.length ?? 0;

  return (
    <div
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", post.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group relative rounded-md border px-1.5 py-1 text-[11px] leading-tight ${meta.chip} ${
        movable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      }`}
      title={`${post.title} — ${meta.label}${post.media_mode ? ` (${post.media_mode})` : ""}`}
    >
      <div className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
        <span className="font-semibold tabular-nums">{post.local_time}</span>
        {mediaCount > 0 && <span className="text-[9px] opacity-70">{mediaCount}▣</span>}
      </div>

      <Link href={`/posts/${post.id}`} className="mt-0.5 line-clamp-2 block hover:underline">
        {post.title}
      </Link>

      {movable && (
        <button
          onClick={onUnschedule}
          className="absolute right-0.5 top-0.5 hidden rounded px-1 text-[10px] text-neutral-500
                     hover:bg-white hover:text-neutral-900 group-hover:block"
          title="Take off the calendar"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function SlotTarget({
  opening,
  armed,
  over,
  busy,
  onOver,
  onLeave,
  onDrop,
}: {
  opening: SlotOccurrence;
  armed: boolean;
  over: boolean;
  busy: boolean;
  onOver: () => void;
  onLeave: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onOver();
      }}
      onDragLeave={onLeave}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy) onDrop();
      }}
      className={`rounded-md border border-dashed px-1.5 py-1 text-[11px] transition-colors ${
        over ? "drop-over" : armed ? "drop-armed" : "border-neutral-200 text-neutral-400"
      }`}
      title={opening.preferred ? `Free — meant for ${opening.preferred}` : "Free slot"}
    >
      <Link
        href={`/posts/new?at=${encodeURIComponent(opening.scheduled_at)}`}
        className="block tabular-nums hover:underline"
      >
        {opening.local_time} <span className="opacity-60">free</span>
      </Link>
    </div>
  );
}

function UnscheduledTray({
  posts,
  onDragStart,
  onDragEnd,
  timezone,
}: {
  posts: Post[];
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  timezone: string;
}) {
  return (
    <aside className="w-full shrink-0 lg:w-72">
      <div className="card sticky top-20 p-3">
        <h2 className="text-sm font-semibold">Waiting for a slot</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Drag one onto a free slot. Times are {timezone}.
        </p>

        <div className="mt-3 max-h-[60vh] space-y-1.5 overflow-y-auto">
          {posts.length === 0 && (
            <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center text-xs text-neutral-400">
              Nothing waiting. Everything written is on the board.
            </p>
          )}

          {posts.map((post) => {
            const meta = STATUS_META[post.status];
            return (
              <div
                key={post.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", post.id);
                  onDragStart(post.id);
                }}
                onDragEnd={onDragEnd}
                className="cursor-grab rounded-lg border border-neutral-200 bg-white p-2 text-xs active:cursor-grabbing hover:border-neutral-300"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    {TYPE_LABEL[post.post_type]}
                  </span>
                </div>
                <Link href={`/posts/${post.id}`} className="mt-1 block font-medium hover:underline">
                  {post.title}
                </Link>
                {post.pillar && (
                  <p className="mt-0.5 truncate text-[10px] text-neutral-400">{post.pillar}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
      {(Object.keys(STATUS_META) as PostStatus[])
        .filter((s) => s !== "archived")
        .map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_META[status].dot}`} />
            {STATUS_META[status].label}
          </span>
        ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-3 rounded border border-dashed border-neutral-300" />
        Free slot
      </span>
    </div>
  );
}
