import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.LOCAL_PREVIEW_DIR || ".next",
  output: "standalone",
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;
