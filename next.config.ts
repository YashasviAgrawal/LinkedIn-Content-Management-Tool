import type { NextConfig } from "next";

const config: NextConfig = {
  // Media is served from Supabase Storage signed URLs; no remote loader needed
  // because <img> is used directly rather than next/image (arbitrary buckets).
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default config;
