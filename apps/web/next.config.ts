import type { NextConfig } from "next";

const config: NextConfig = {
  // `next dev` and `next build` must not share a folder: a build overwrites the running dev server's files.
  // Verification builds set NEXT_DIST_DIR (for example .scratch-build); normal runs keep .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@handover/core"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Not "no-referrer": that makes browsers send Origin: null on form posts, which breaks sign-in.
          // "same-origin" still sends no referrer to other sites.
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default config;
