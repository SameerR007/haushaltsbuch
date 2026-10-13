import type { Metadata } from "next";
import { ChangeAssistant } from "@/components/data/change-assistant";
import "../../setup/setup.css";

export const metadata: Metadata = {
  title: "Change assistant · Haushaltsbuch",
};

export default function ChangeAssistantPage() {
  return <ChangeAssistant />;
}
