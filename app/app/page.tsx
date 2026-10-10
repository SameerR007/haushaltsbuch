import type { Metadata } from "next";
import { TrackerChat } from "@/components/tracker/tracker-chat";

export const metadata: Metadata = {
  title: "Chat · Haushaltsbuch",
};

export default function TrackerPage() {
  return <TrackerChat />;
}
