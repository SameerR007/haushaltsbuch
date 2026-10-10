import type { Metadata } from "next";
import { StartOver } from "@/components/data/start-over";

export const metadata: Metadata = {
  title: "Set up completely new · Haushaltsbuch",
};

export default function ResetPage() {
  return <StartOver />;
}
