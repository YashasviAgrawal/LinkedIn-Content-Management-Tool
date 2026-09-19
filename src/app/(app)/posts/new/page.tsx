import { PostEditor } from "@/components/post-editor";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** `?at=<iso>` arrives from clicking a free slot on the calendar. */
export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string }>;
}) {
  const { at } = await searchParams;
  return <PostEditor initialPost={null} initialAt={at} timezone={env.timezone} />;
}
