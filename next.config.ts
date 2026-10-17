import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "exceljs", "unpdf", "@napi-rs/canvas"],
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
