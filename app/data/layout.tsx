import type { ReactNode } from "react";
import "./data.css";

export default function DataLayout({ children }: { children: ReactNode }) {
  return <div className="data-root">{children}</div>;
}
