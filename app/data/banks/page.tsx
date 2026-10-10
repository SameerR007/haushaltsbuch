import type { Metadata } from "next";
import { BankManager } from "@/components/data/bank-manager";

export const metadata: Metadata = {
  title: "Add / Remove banks · Haushaltsbuch",
};

export default function BanksPage() {
  return <BankManager />;
}
