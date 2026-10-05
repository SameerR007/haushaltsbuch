import type { Metadata } from "next";
import { SetupChat } from "@/components/setup/setup-chat";
import "./setup.css";

export const metadata: Metadata = {
  title: "Setup · Haushaltsbuch",
};

export default function SetupPage() {
  return <SetupChat />;
}
