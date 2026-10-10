import type { Metadata } from "next";
import { YourData } from "@/components/data/your-data";

export const metadata: Metadata = {
  title: "Your data · Haushaltsbuch",
};

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string | string[] }>;
}) {
  const params = await searchParams;
  const updated = params.updated === "1";
  return <YourData updated={updated} />;
}
