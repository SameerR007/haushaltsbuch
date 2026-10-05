import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Setup · Haushaltsbuch",
};

export default function SetupStub() {
  return (
    <main className="stub">
      <h1>Setup</h1>
      <p>Setup isn’t built yet.</p>
      <Link href="/">Back to welcome</Link>
    </main>
  );
}
