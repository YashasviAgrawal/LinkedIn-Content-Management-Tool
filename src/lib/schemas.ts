import { z } from "zod";
import { POST_STATUSES, POST_TYPES } from "./types";

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/));

export const postCreateSchema = z.object({
  title: z.string().min(1, "A post needs a title"),
  body: z.string().default(""),
  slug: z.string().optional().nullable(),
  status: z.enum(POST_STATUSES).default("draft"),
  post_type: z.enum(POST_TYPES).default("text"),

  /** UTC instant. Mutually exclusive with local_date + local_time. */
  scheduled_at: isoDateTime.nullable().optional(),
  /** Wall clock in APP_TIMEZONE — what a human or Claude Code actually knows. */
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  local_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  /** 'next' books the earliest free slot on the grid. */
  slot: z.literal("next").optional(),

  pillar: z.string().nullable().optional(),
  hook_type: z.string().nullable().optional(),
  cta: z.string().nullable().optional(),
  audience: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  invented_content: z.string().nullable().optional(),
  sources: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  doc_title: z.string().nullable().optional(),
  source_path: z.string().nullable().optional(),
  created_by: z.string().default("webapp"),
});

export const postUpdateSchema = postCreateSchema.partial().extend({
  /** Explicit null clears the schedule and drops the post off the board. */
  scheduled_at: isoDateTime.nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
});

export const scheduleSchema = z
  .object({
    scheduled_at: isoDateTime.optional(),
    local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    local_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    slot: z.literal("next").optional(),
    /** Book the earliest free slot at or after this local date. */
    after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Take the slot even if something is already on it (that post is unscheduled). */
    force: z.boolean().default(false),
  })
  .refine(
    (v) => Boolean(v.scheduled_at || (v.local_date && v.local_time) || v.slot),
    { message: "Provide scheduled_at, or local_date + local_time, or slot:'next'" },
  );

export const slotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  time_local: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  label: z.string().nullable().optional(),
  preferred: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

export const slotUpdateSchema = slotSchema.partial();

export const mediaMetaSchema = z.object({
  alt_text: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const mediaReorderSchema = z.object({
  order: z.array(z.string().uuid()).min(1),
});

export type PostCreateInput = z.infer<typeof postCreateSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
