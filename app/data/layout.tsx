import type { ReactNode } from "react";
import { DataChrome } from "@/components/data/data-chrome";
import "./data.css";

export default function DataLayout({ children }: { children: ReactNode }) {
  return <DataChrome>{children}</DataChrome>;
}
