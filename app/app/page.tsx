import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Tracker · Haushaltsbuch",
};

export default function TrackerStub() {
  return (
    <main className="stub">
      <h1>Tracker</h1>
      <p>The tracker isn’t built yet.</p>
      <Link href="/">Back to welcome</Link>
      {" · "}
      <Link href="/setup">Change keys</Link>
    </main>
  );
}
