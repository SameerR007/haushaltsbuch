import type { NextConfig } from "next";

// No anonymous usage reports to Next.js. Set here because Next reads this config before it starts telemetry.
process.env.NEXT_TELEMETRY_DISABLED ??= "1";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "exceljs", "unpdf", "@napi-rs/canvas"],
  // No other site may show these pages in a frame (so nobody can trick a click on "Start over").
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  // Old paths from before the routes were renamed, so saved links still work.
  async redirects() {
    return [
      { source: "/setup", has: [{ type: "query", key: "mode" }], destination: "/setup/chat", permanent: false },
      { source: "/welcome", destination: "/setup", permanent: false },
      { source: "/app", destination: "/chat", permanent: false },
      { source: "/app/:path*", destination: "/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
