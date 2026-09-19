import Link from "next/link";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { formatSlotLabel, relative } from "@/lib/time";
import { STATUS_META, TYPE_LABEL, type Post, type PostStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string; statuses?: PostStatus[] }[] = [
  { key: "all", label: "All" },
  { key: "queue", label: "Queued", statuses: ["scheduled", "publishing"] },
  { key: "waiting", label: "Waiting", statuses: ["draft", "approved"] },
  { key: "live", label: "Live", statuses: ["published"] },
  { key: "attention", label: "Needs attention", statuses: ["failed", "manual_required"] },
];

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const { filter = "all", q } = await searchParams;
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  let query = db()
    .from("posts")
    .select("*, media:post_media(id)")
    .order("scheduled_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(300);

  if (active.statuses) query = query.in("status", active.statuses);
  if (q) query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);

  const { data, error } = await query;
  const posts = (data ?? []) as (Post & { media: { id: string }[] })[];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Posts</h1>

        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/posts?filter=${f.key}`}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                f.key === active.key
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <form className="ml-auto flex gap-2" action="/posts">
          <input type="hidden" name="filter" value={active.key} />
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search title or body…"
            className="field w-56"
          />
          <Link href="/posts/new" className="btn-primary shrink-0">
            New post
          </Link>
        </form>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {posts.length === 0 ? (
        <p className="card px-4 py-16 text-center text-sm text-neutral-400">
          Nothing here yet. Posts pushed from Claude Code show up automatically.
        </p>
      ) : (
        <div className="card divide-y divide-neutral-100 overflow-hidden">
          {posts.map((post) => {
            const meta = STATUS_META[post.status];
            return (
              <Link
                key={post.id}
                href={`/posts/${post.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-neutral-50"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} title={meta.label} />

                <span className="min-w-0 flex-1 basis-64">
                  <span className="block truncate text-sm font-medium">{post.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-400">
                    {[TYPE_LABEL[post.post_type], post.pillar, post.cta]
                      .filter(Boolean)
                      .join(" · ")}
                    {post.media.length > 0 && ` · ${post.media.length} file(s)`}
                  </span>
                </span>

                <span className="w-44 shrink-0 text-xs tabular-nums text-neutral-500">
                  {post.scheduled_at ? (
                    <>
                      {formatSlotLabel(post.scheduled_at, env.timezone)}
                      <span className="block text-neutral-400">{relative(post.scheduled_at)}</span>
                    </>
                  ) : (
                    <span className="text-neutral-300">no slot</span>
                  )}
                </span>

                <span className={`chip shrink-0 ${meta.chip}`}>{meta.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
