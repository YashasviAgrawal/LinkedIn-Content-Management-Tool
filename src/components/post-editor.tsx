"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  POST_STATUSES,
  POST_TYPES,
  STATUS_META,
  TYPE_LABEL,
  type Post,
  type PostMedia,
  type PublishLogRow,
  type SlotOccurrence,
} from "@/lib/types";

/** LinkedIn truncates the feed preview here; everything after is behind "…more". */
const FOLD = 210;
const MAX_CHARS = 3000;

type Draft = Partial<Post>;

export function PostEditor({
  initialPost,
  initialLog = [],
  initialAt,
  timezone,
}: {
  initialPost: Post | null;
  initialLog?: PublishLogRow[];
  initialAt?: string;
  timezone: string;
}) {
  const router = useRouter();
  const isNew = !initialPost;

  const [post, setPost] = useState<Draft>(
    initialPost ?? { title: "", body: "", status: "draft", post_type: "text", tags: [] },
  );
  const [media, setMedia] = useState<PostMedia[]>(initialPost?.media ?? []);
  const [log] = useState<PublishLogRow[]>(initialLog);
  const [savedId, setSavedId] = useState<string | null>(initialPost?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [freeSlots, setFreeSlots] = useState<SlotOccurrence[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (patch: Draft) => setPost((p) => ({ ...p, ...patch }));

  useEffect(() => {
    fetch("/api/slots/free?count=14")
      .then((r) => r.json())
      .then((d) => !d.error && setFreeSlots(d.free ?? []))
      .catch(() => {});
  }, [savedId]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  async function save() {
    if (!post.title?.trim()) {
      setNote({ text: "Give it a title first.", bad: true });
      return;
    }
    setBusy("save");

    const payload = {
      title: post.title,
      body: post.body ?? "",
      status: post.status,
      post_type: post.post_type,
      pillar: post.pillar ?? null,
      hook_type: post.hook_type ?? null,
      cta: post.cta ?? null,
      audience: post.audience ?? null,
      notes: post.notes ?? null,
      invented_content: post.invented_content ?? null,
      sources: post.sources ?? null,
      doc_title: post.doc_title ?? null,
      source_path: post.source_path ?? null,
      // A brand-new post created from a free-slot link lands on that slot.
      ...(isNew && initialAt ? { scheduled_at: initialAt } : {}),
    };

    const response = await fetch(savedId ? `/api/posts/${savedId}` : "/api/posts", {
      method: savedId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    setBusy(null);

    if (!response.ok) {
      setNote({ text: body.error ?? "Save failed.", bad: true });
      return;
    }

    setPost(body.post);
    if (!savedId) {
      setSavedId(body.post.id);
      router.replace(`/posts/${body.post.id}`);
    }
    setNote({ text: "Saved." });
    router.refresh();
  }

  async function schedule(body: Record<string, unknown>) {
    if (!savedId) {
      setNote({ text: "Save the post before scheduling it.", bad: true });
      return;
    }
    setBusy("schedule");
    const response = await fetch(`/api/posts/${savedId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    setBusy(null);

    if (response.ok) {
      setPost(data.post);
      setNote({ text: `Scheduled for ${data.scheduled_for.local}.` });
      router.refresh();
    } else {
      setNote({ text: data.error ?? "Could not schedule that.", bad: true });
    }
  }

  async function unschedule() {
    if (!savedId) return;
    setBusy("schedule");
    const response = await fetch(`/api/posts/${savedId}/schedule`, { method: "DELETE" });
    const data = await response.json();
    setBusy(null);
    if (response.ok) {
      setPost(data.post);
      setNote({ text: "Taken off the calendar." });
      router.refresh();
    } else {
      setNote({ text: data.error ?? "Could not unschedule.", bad: true });
    }
  }

  async function publishNow() {
    if (!savedId) return;
    if (!confirm(`Publish "${post.title}" to LinkedIn right now?`)) return;

    setBusy("publish");
    const response = await fetch(`/api/posts/${savedId}/publish`, { method: "POST" });
    const data = await response.json();
    setBusy(null);

    setNote({ text: data.message ?? (response.ok ? "Published." : "Publish failed."), bad: !response.ok });
    router.refresh();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (!savedId) {
      setNote({ text: "Save the post before attaching files.", bad: true });
      return;
    }

    setBusy("upload");
    const form = new FormData();
    // Filename order is carousel order — the same rule the Python publisher uses.
    for (const file of Array.from(files).sort((a, b) => a.name.localeCompare(b.name))) {
      form.append("file", file);
    }

    const response = await fetch(`/api/posts/${savedId}/media`, { method: "POST", body: form });
    const data = await response.json();
    setBusy(null);

    if (response.ok) {
      setMedia((m) => [...m, ...data.media]);
      if (data.post_type) set({ post_type: data.post_type });
      setNote({ text: `Attached ${data.media.length} file(s).` });
    } else {
      setNote({ text: data.error ?? "Upload failed.", bad: true });
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function removeMedia(id: string) {
    setBusy("upload");
    const response = await fetch(`/api/media/${id}`, { method: "DELETE" });
    setBusy(null);
    if (response.ok) setMedia((m) => m.filter((x) => x.id !== id));
    else setNote({ text: "Could not remove that file.", bad: true });
  }

  async function saveAlt(id: string, alt: string) {
    await fetch(`/api/media/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: alt }),
    });
  }

  async function remove() {
    if (!savedId) return;
    if (!confirm("Delete this post and its files? This cannot be undone.")) return;
    setBusy("delete");
    const response = await fetch(`/api/posts/${savedId}`, { method: "DELETE" });
    setBusy(null);
    if (response.ok) router.push("/posts");
    else setNote({ text: "Could not delete that.", bad: true });
  }

  const chars = (post.body ?? "").length;
  const meta = STATUS_META[post.status ?? "draft"];

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ── the post itself ──────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/posts" className="btn-ghost">
            ← Posts
          </Link>
          <span className={`chip ${meta.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          {post.linkedin_url && (
            <a
              href={post.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="chip border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            >
              View on LinkedIn ↗
            </a>
          )}

          <div className="ml-auto flex gap-2">
            <button className="btn-primary" onClick={save} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            {savedId && (
              <button className="btn-danger" onClick={remove} disabled={busy !== null}>
                Delete
              </button>
            )}
          </div>
        </div>

        {note && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              note.bad
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {note.text}
          </div>
        )}

        {post.invented_content && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>Check before posting:</strong> {post.invented_content}
          </div>
        )}

        {post.last_error && post.status === "failed" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <strong>Last error:</strong> {post.last_error}
          </div>
        )}

        <div className="card p-4">
          <label className="label" htmlFor="title">
            Title <span className="normal-case text-neutral-400">— internal, not published</span>
          </label>
          <input
            id="title"
            className="field text-base font-medium"
            value={post.title ?? ""}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Name the person doing the task"
          />

          <div className="mt-4 flex items-baseline justify-between">
            <label className="label mb-0" htmlFor="body">
              Post text
            </label>
            <span
              className={`text-xs tabular-nums ${
                chars > MAX_CHARS ? "text-red-600" : "text-neutral-400"
              }`}
            >
              {chars.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
          </div>
          <textarea
            id="body"
            className="field mt-1 min-h-[26rem] font-mono text-[13px] leading-relaxed"
            value={post.body ?? ""}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="The hook goes on line one…"
          />

          <FoldPreview body={post.body ?? ""} />
        </div>

        <MediaPanel
          media={media}
          busy={busy === "upload"}
          fileInput={fileInput}
          onUpload={upload}
          onRemove={removeMedia}
          onAlt={saveAlt}
          disabled={!savedId}
        />

        {log.length > 0 && <PublishLog log={log} />}
      </div>

      {/* ── settings rail ────────────────────────────────────────────────── */}
      <aside className="w-full shrink-0 space-y-4 lg:w-80">
        <SchedulePanel
          post={post}
          freeSlots={freeSlots}
          timezone={timezone}
          busy={busy}
          disabled={!savedId}
          onSchedule={schedule}
          onUnschedule={unschedule}
          onPublishNow={publishNow}
        />

        <div className="card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="type">
              Format
            </label>
            <select
              id="type"
              className="field"
              value={post.post_type ?? "text"}
              onChange={(e) => set({ post_type: e.target.value as Post["post_type"] })}
            >
              {POST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {post.post_type === "poll" && (
              <p className="mt-1 text-xs text-orange-700">
                LinkedIn has no poll API. At its slot time this gets flagged &ldquo;post by
                hand&rdquo; rather than published.
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              className="field"
              value={post.status ?? "draft"}
              onChange={(e) => set({ status: e.target.value as Post["status"] })}
            >
              {POST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>

          {post.post_type === "carousel_pdf" && (
            <div>
              <label className="label" htmlFor="doc_title">
                Card title
              </label>
              <input
                id="doc_title"
                className="field"
                value={post.doc_title ?? ""}
                onChange={(e) => set({ doc_title: e.target.value })}
                placeholder="1 workflow. Not a cofounder."
              />
              <p className="mt-1 text-xs text-neutral-400">
                Read before anyone swipes — treat it as a second hook.
              </p>
            </div>
          )}

          {(
            [
              ["pillar", "Pillar"],
              ["hook_type", "Hook type"],
              ["cta", "CTA"],
              ["audience", "Audience"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="label" htmlFor={key}>
                {label}
              </label>
              <input
                id={key}
                className="field"
                value={(post[key] as string) ?? ""}
                onChange={(e) => set({ [key]: e.target.value } as Draft)}
              />
            </div>
          ))}

          <div>
            <label className="label" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              className="field min-h-20 text-xs"
              value={post.notes ?? ""}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          {post.source_path && (
            <p className="text-xs text-neutral-400">
              From <code className="font-mono">{post.source_path}</code>
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/** What the feed shows before "…more" — the only part most people read. */
function FoldPreview({ body }: { body: string }) {
  const above = body.slice(0, FOLD);
  const hidden = Math.max(0, body.length - FOLD);

  return (
    <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <summary className="cursor-pointer text-xs font-medium text-neutral-600">
        Feed preview — first {FOLD} characters
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">
        {above}
        {hidden > 0 && <span className="text-neutral-400"> …more ({hidden} more chars)</span>}
      </p>
    </details>
  );
}

function SchedulePanel({
  post,
  freeSlots,
  timezone,
  busy,
  disabled,
  onSchedule,
  onUnschedule,
  onPublishNow,
}: {
  post: Draft;
  freeSlots: SlotOccurrence[];
  timezone: string;
  busy: string | null;
  disabled: boolean;
  onSchedule: (body: Record<string, unknown>) => void;
  onUnschedule: () => void;
  onPublishNow: () => void;
}) {
  const [custom, setCustom] = useState("");
  const live = post.status === "published";

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold">Schedule</h2>
      <p className="mt-0.5 text-xs text-neutral-500">{timezone}</p>

      {post.scheduled_at ? (
        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
          <p className="text-sm font-medium text-violet-900">
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: timezone,
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(new Date(post.scheduled_at))}
          </p>
          {!live && (
            <button
              onClick={onUnschedule}
              disabled={busy !== null}
              className="mt-1 text-xs text-violet-700 underline hover:text-violet-900"
            >
              Take off the calendar
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-400">Not on the calendar.</p>
      )}

      {!live && (
        <>
          <button
            className="btn-ghost mt-3 w-full"
            disabled={disabled || busy !== null}
            onClick={() => onSchedule({ slot: "next" })}
          >
            {busy === "schedule" ? "Booking…" : "Book the next free slot"}
          </button>

          {freeSlots.length > 0 && (
            <div className="mt-3">
              <label className="label" htmlFor="freeslot">
                Or pick one
              </label>
              <select
                id="freeslot"
                className="field"
                defaultValue=""
                disabled={disabled || busy !== null}
                onChange={(e) => e.target.value && onSchedule({ scheduled_at: e.target.value })}
              >
                <option value="">Free slots…</option>
                {freeSlots.map((slot) => (
                  <option key={slot.scheduled_at} value={slot.scheduled_at}>
                    {slot.day_name.slice(0, 3)} {slot.local_date.slice(5)} · {slot.local_time}
                    {slot.preferred ? ` — ${slot.preferred}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3">
            <label className="label" htmlFor="custom">
              Or any time
            </label>
            <div className="flex gap-1.5">
              <input
                id="custom"
                type="datetime-local"
                className="field"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <button
                className="btn-ghost shrink-0"
                disabled={disabled || !custom || busy !== null}
                onClick={() => {
                  const [date, time] = custom.split("T");
                  onSchedule({ local_date: date, local_time: time.slice(0, 5), force: true });
                }}
              >
                Set
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              Read as {timezone} wall clock. Takes the slot even if occupied.
            </p>
          </div>

          <hr className="my-4 border-neutral-100" />

          <button
            className="btn-ghost w-full"
            disabled={disabled || busy !== null}
            onClick={onPublishNow}
          >
            {busy === "publish" ? "Publishing…" : "Publish now"}
          </button>
        </>
      )}

      {disabled && (
        <p className="mt-2 text-xs text-neutral-400">Save the post to unlock these.</p>
      )}
    </div>
  );
}

function MediaPanel({
  media,
  busy,
  fileInput,
  onUpload,
  onRemove,
  onAlt,
  disabled,
}: {
  media: PostMedia[];
  busy: boolean;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onUpload: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  onAlt: (id: string, alt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Media <span className="font-normal text-neutral-400">({media.length})</span>
        </h2>
        <button
          className="btn-ghost"
          disabled={disabled || busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? "Uploading…" : "Attach files"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
      </div>

      {media.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center text-xs text-neutral-400">
          {disabled
            ? "Save the post first, then attach images or a carousel PDF."
            : "Images attach as a post; a PDF attaches as a swipeable carousel."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {media.map((file) => (
            <li key={file.id} className="flex gap-3 rounded-lg border border-neutral-200 p-2">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-neutral-100">
                {file.kind === "image" && file.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-neutral-500">
                    PDF
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  <span className="mr-1 text-neutral-400">{file.position}</span>
                  {file.file_name}
                </p>
                <input
                  className="field mt-1 py-1 text-xs"
                  defaultValue={file.alt_text ?? ""}
                  placeholder="Alt text — describe what the card says"
                  onBlur={(e) => onAlt(file.id, e.target.value)}
                />
              </div>

              <button
                onClick={() => onRemove(file.id)}
                className="self-start text-xs text-neutral-400 hover:text-red-600"
                title="Remove"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PublishLog({ log }: { log: PublishLogRow[] }) {
  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold">Publish log</h2>
      <ul className="mt-2 space-y-1.5">
        {log.map((row) => (
          <li key={row.id} className="flex gap-2 text-xs">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${row.ok ? "bg-emerald-500" : "bg-red-500"}`} />
            <span className="shrink-0 tabular-nums text-neutral-400">
              {new Date(row.attempted_at).toLocaleString()}
            </span>
            <span className="text-neutral-600">{row.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
