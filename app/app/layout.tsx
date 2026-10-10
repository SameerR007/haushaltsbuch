import { TrackerHeader } from "@/components/tracker/header";
import "./tracker.css";

export default function TrackerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tracker-root">
      <TrackerHeader />
      {children}
    </div>
  );
}
