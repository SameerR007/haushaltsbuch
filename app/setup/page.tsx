import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { WelcomeAssistant } from "@/components/welcome-assistant";
import { TRACKER_HOME } from "@/components/tracker/nav";

export const metadata: Metadata = {
  title: "Setup · Haushaltsbuch",
};

export default function Setup() {
  return (
    <>
      <SiteNav className="site-nav-float" />
    <main className="card">
      <p className="eyebrow">Local · Private</p>
      <h1>Welcome to Haushaltsbuch</h1>
      <p className="lede">
        Track spending in plain language. Your money stays in a database on
        this computer — the app runs on your machine.
      </p>
      <WelcomeAssistant />
      <div className="actions">
        <Link className="primary first-only" href="/setup/chat">
          Get started
        </Link>
        <Link className="primary returning-only" href={TRACKER_HOME}>
          Open tracker
        </Link>
        <Link className="linkish returning-only" href="/data">
          Review the data
        </Link>
      </div>
      <p className="foot first-only">
        We’ll ask where the assistant should think, then currency (default €) and your banks.
      </p>
      <p className="foot returning-only">
        Welcome back — pick up where you left off.
      </p>
      <div className="pills">
        <span className="pill first-only">Default €</span>
        <span className="pill">Chat + summary</span>
        <span className="pill">On this computer</span>
      </div>
    </main>
    </>
  );
}
