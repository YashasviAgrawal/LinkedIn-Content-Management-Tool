export const POST_STATUSES = [
  "draft",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "manual_required",
  "archived",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_TYPES = [
  "text",
  "image",
  "multi_image",
  "carousel_pdf",
  "poll",
  "article",
] as const;
export type PostType = (typeof POST_TYPES)[number];

export type MediaKind = "image" | "document";

export interface PostMedia {
  id: string;
  post_id: string;
  kind: MediaKind;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number | null;
  alt_text: string | null;
  position: number;
  created_at: string;
  /** Added by the API, not stored. */
  url?: string | null;
}

export interface Post {
  id: string;
  title: string;
  slug: string | null;
  body: string;
  status: PostStatus;
  post_type: PostType;
  scheduled_at: string | null;
  published_at: string | null;
  slot_id: string | null;
  pillar: string | null;
  hook_type: string | null;
  cta: string | null;
  audience: string | null;
  notes: string | null;
  invented_content: string | null;
  sources: string | null;
  tags: string[];
  doc_title: string | null;
  linkedin_post_id: string | null;
  linkedin_url: string | null;
  media_mode: string | null;
  last_error: string | null;
  attempts: number;
  locked_at: string | null;
  source_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  media?: PostMedia[];
}

export interface Slot {
  id: string;
  day_of_week: number; // 0 = Sunday
  time_local: string; // 'HH:MM'
  label: string | null;
  preferred: string | null;
  active: boolean;
  created_at: string;
}

/** One concrete future occurrence of a slot. */
export interface SlotOccurrence {
  slot_id: string;
  /** UTC instant, ISO. */
  scheduled_at: string;
  /** Local date 'YYYY-MM-DD' in APP_TIMEZONE. */
  local_date: string;
  local_time: string; // 'HH:MM'
  day_of_week: number;
  day_name: string;
  label: string | null;
  preferred: string | null;
  taken: boolean;
  taken_by?: { id: string; title: string; status: PostStatus } | null;
}

export interface PublishLogRow {
  id: string;
  post_id: string | null;
  attempted_at: string;
  ok: boolean;
  http_status: number | null;
  message: string | null;
  detail: unknown;
  trigger: string;
}

export const STATUS_META: Record<
  PostStatus,
  { label: string; dot: string; chip: string }
> = {
  draft: {
    label: "Draft",
    dot: "bg-neutral-400",
    chip: "bg-neutral-100 text-neutral-700 border-neutral-200",
  },
  approved: {
    label: "Approved",
    dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
  },
  scheduled: {
    label: "Scheduled",
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700 border-violet-200",
  },
  publishing: {
    label: "Publishing",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-800 border-amber-200",
  },
  published: {
    label: "Live",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-500",
    chip: "bg-red-50 text-red-700 border-red-200",
  },
  manual_required: {
    label: "Post by hand",
    dot: "bg-orange-500",
    chip: "bg-orange-50 text-orange-800 border-orange-200",
  },
  archived: {
    label: "Archived",
    dot: "bg-neutral-300",
    chip: "bg-neutral-50 text-neutral-500 border-neutral-200",
  },
};

export const TYPE_LABEL: Record<PostType, string> = {
  text: "Text",
  image: "Image",
  multi_image: "Multi-image",
  carousel_pdf: "Carousel (PDF)",
  poll: "Poll",
  article: "Link",
};
