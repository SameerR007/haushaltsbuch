import type { Metadata } from "next";
import { SetupChat } from "@/components/setup/setup-chat";
import "./setup.css";

export const metadata: Metadata = {
  title: "Setup · Haushaltsbuch",
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const params = await searchParams;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  return <SetupChat startAtKeys={mode === "keys"} />;
}
