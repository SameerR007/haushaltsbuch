import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "exceljs", "unpdf", "@napi-rs/canvas"],
};

export default nextConfig;
