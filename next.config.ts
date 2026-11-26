import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg", "msedge-tts"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
