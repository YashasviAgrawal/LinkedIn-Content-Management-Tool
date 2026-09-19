/**
 * LinkedIn publishing — a port of integrations/linkedin.py so the scheduler can
 * publish without shelling out to Python.
 *
 * Two APIs are in play, because LinkedIn split them:
 *   • text and images  → /v2/ugcPosts       (legacy, unversioned)
 *   • PDF carousels    → /rest/posts        (versioned, needs LinkedIn-Version)
 *
 * The version header is walked back month by month when a pinned version dies,
 * matching the Python behaviour. 202510 was verified working on 2026-09-19.
 */

import { env } from "./env";

const API_BASE = "https://api.linkedin.com/v2";
const REST_BASE = "https://api.linkedin.com/rest";
const PINNED_VERSION = "202510";

export interface PublishResult {
  post_id: string;
  post_url: string;
  media_mode: string;
  api_version?: string;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.linkedinToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

function versionedHeaders(version: string): Record<string, string> {
  return { ...headers(), "LinkedIn-Version": version };
}

/** The pinned version first, then recent months newest-first. */
function candidateVersions(pinned = PINNED_VERSION): string[] {
  const out = [pinned];
  const seen = new Set(out);
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i < 14; i++) {
    const v = `${y}${String(m).padStart(2, "0")}`;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
    m -= 1;
    if (m === 0) {
      y -= 1;
      m = 12;
    }
  }
  return out;
}

function postUrl(postId: string): string {
  return postId
    ? `https://www.linkedin.com/feed/update/${postId}/`
    : "Published (URL unavailable)";
}

// ── uploads ─────────────────────────────────────────────────────────────────

/**
 * Register and upload one image, returning its asset URN.
 *
 * Uploading on its own publishes nothing — an asset with no post attached is
 * invisible on the profile, which is what makes this safe to smoke-test.
 */
export async function uploadImage(bytes: Buffer): Promise<string> {
  const register = await fetch(`${API_BASE}/assets?action=registerUpload`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: env.linkedinPersonUrn,
        serviceRelationships: [
          { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
        ],
      },
    }),
  });

  if (!register.ok) {
    throw new Error(
      `LinkedIn registerUpload error ${register.status}: ${await register.text()}`,
    );
  }

  const value = (await register.json()).value;
  const uploadUrl =
    value.uploadMechanism[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ].uploadUrl;

  // The binary PUT takes the bearer token but NOT the JSON content type.
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.linkedinToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(bytes),
  });

  if (!upload.ok) {
    throw new Error(`LinkedIn image upload error ${upload.status}: ${await upload.text()}`);
  }

  return value.asset as string;
}

/** Register and upload a PDF, returning its document URN and the API version used. */
export async function uploadDocument(
  bytes: Buffer,
): Promise<{ urn: string; version: string }> {
  let uploadUrl = "";
  let urn = "";
  let version = "";
  let last = "";

  for (const candidate of candidateVersions()) {
    const r = await fetch(`${REST_BASE}/documents?action=initializeUpload`, {
      method: "POST",
      headers: versionedHeaders(candidate),
      body: JSON.stringify({
        initializeUploadRequest: { owner: env.linkedinPersonUrn },
      }),
    });

    if (r.ok) {
      const value = (await r.json()).value;
      uploadUrl = value.uploadUrl;
      urn = value.document;
      version = candidate;
      break;
    }

    const text = await r.text();
    last = `${candidate} → ${r.status}: ${text}`;
    // Only a dead version is worth retrying; anything else is a real error.
    if (!text.includes("NONEXISTENT_VERSION")) {
      throw new Error(`LinkedIn document initializeUpload error ${r.status}: ${text}`);
    }
  }

  if (!urn) throw new Error(`No active LinkedIn API version found. Last try: ${last}`);

  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.linkedinToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(bytes),
  });

  if (!upload.ok) {
    throw new Error(
      `LinkedIn document upload error ${upload.status}: ${await upload.text()}`,
    );
  }

  return { urn, version };
}

// ── posting ─────────────────────────────────────────────────────────────────

/**
 * Reserved in the versioned Posts API's `commentary` field. '#' is left alone
 * so hashtags still render as hashtags.
 */
const COMMENTARY_RESERVED = new Set("\\|{}@[]()<>*_~".split(""));

export function escapeCommentary(text: string): string {
  let out = "";
  for (const ch of text) out += COMMENTARY_RESERVED.has(ch) ? `\\${ch}` : ch;
  return out;
}

export interface ImageAttachment {
  bytes: Buffer;
  alt?: string | null;
}

/** Text, or text + up to 20 images, via the legacy ugcPosts endpoint. */
export async function publishShare(
  text: string,
  images: ImageAttachment[] = [],
): Promise<PublishResult> {
  if (images.length > 20) {
    throw new Error(`LinkedIn allows at most 20 images per post; got ${images.length}.`);
  }

  const shareContent: Record<string, unknown> = {
    shareCommentary: { text },
    shareMediaCategory: "NONE",
  };

  if (images.length > 0) {
    const media = [];
    for (const image of images) {
      const entry: Record<string, unknown> = {
        status: "READY",
        media: await uploadImage(image.bytes),
      };
      if (image.alt) entry.description = { text: image.alt };
      media.push(entry);
    }
    shareContent.shareMediaCategory = "IMAGE";
    shareContent.media = media;
  }

  const response = await fetch(`${API_BASE}/ugcPosts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      author: env.linkedinPersonUrn,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });

  if (!response.ok) {
    throw new Error(`LinkedIn API error ${response.status}: ${await response.text()}`);
  }

  const postId =
    response.headers.get("x-restli-id") ?? response.headers.get("X-RestLi-Id") ?? "";

  return {
    post_id: postId,
    post_url: postUrl(postId),
    media_mode: images.length ? `${images.length} image(s)` : "text only",
  };
}

/**
 * Publish a PDF as a native document post — the real swipeable carousel, with
 * page arrows and a page counter. `title` shows on the card, so it is read
 * before anyone swipes.
 */
export async function publishDocument(
  text: string,
  pdf: Buffer,
  title: string,
): Promise<PublishResult> {
  const { urn, version } = await uploadDocument(pdf);

  const response = await fetch(`${REST_BASE}/posts`, {
    method: "POST",
    headers: versionedHeaders(version),
    body: JSON.stringify({
      author: env.linkedinPersonUrn,
      commentary: escapeCommentary(text),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: { media: { title, id: urn } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `LinkedIn document post error ${response.status}: ${await response.text()}`,
    );
  }

  const postId =
    response.headers.get("x-restli-id") ?? response.headers.get("X-RestLi-Id") ?? "";

  return {
    post_id: postId,
    post_url: postUrl(postId),
    media_mode: `document (${version})`,
    api_version: version,
  };
}

/** Confirm the token and URN work, without publishing anything. */
export async function checkCredentials(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch(`${API_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${env.linkedinToken}` },
    });
    if (r.ok) return { ok: true, detail: "Token accepted by /v2/userinfo." };
    return { ok: false, detail: `LinkedIn returned ${r.status}: ${await r.text()}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
