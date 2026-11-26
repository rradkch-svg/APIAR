import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export" as const,
        basePath: basePath || undefined,
        trailingSlash: true,
      }
    : {
        serverExternalPackages: ["@electric-sql/pglite", "pg", "msedge-tts"],
      }),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
