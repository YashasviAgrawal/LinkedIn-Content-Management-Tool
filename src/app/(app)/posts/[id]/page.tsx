import { notFound } from "next/navigation";
import { PostEditor } from "@/components/post-editor";
import { env } from "@/lib/env";
import { db, signedUrl } from "@/lib/supabase";
import type { Post, PostMedia, PublishLogRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: post } = await db()
    .from("posts")
    .select("*, media:post_media(*)")
    .eq("id", id)
    .single();

  if (!post) notFound();

  const media = ((post.media ?? []) as PostMedia[]).sort((a, b) => a.position - b.position);
  for (const file of media) file.url = await signedUrl(file.storage_path);

  const { data: log } = await db()
    .from("publish_log")
    .select("*")
    .eq("post_id", id)
    .order("attempted_at", { ascending: false })
    .limit(20);

  return (
    <PostEditor
      initialPost={{ ...post, media } as Post}
      initialLog={(log ?? []) as PublishLogRow[]}
      timezone={env.timezone}
    />
  );
}
