import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { HomeVideo } from "@/components/home-video";

export default function Home() {
  return (
    <>
      <SiteNav className="site-nav-float" />
    <main className="home">
      <section className="home-copy">
        <p className="eyebrow">Local · Private</p>
        <h1 className="home-title">Haushaltsbuch</h1>
        <p className="home-tagline">Your household budget, in plain language.</p>
        <p className="home-desc">
          Haushaltsbuch keeps your household&rsquo;s expenses in a database on your
          own computer that you can chat with. Ask anything about your money, and
          the answer comes from everything you have saved.{" "}
          <strong>It stays saved between visits</strong>, so you can add more
          whenever you like.
        </p>
        <ul className="home-points">
          <li>
            <strong>Add expenses your way, saved for good.</strong> Type them in the
            chat, or upload a bank statement PDF and review the rows. Everything goes
            into a persistent database on your computer, so you can come back and add
            more any time.
          </li>
          <li>
            <strong>Chat with your expenses.</strong> Ask &ldquo;what did I spend on
            groceries in March?&rdquo; and get a straight answer from your database.
          </li>
          <li>
            <strong>Analyse any period.</strong> Look at a month or any date range, and
            compare two periods side by side.
          </li>
          <li>
            <strong>Fully local if you want.</strong> Run the AI on your computer so
            nothing leaves it, or connect OpenAI instead.
          </li>
        </ul>

        {/* One button for everyone: first visit goes to setup, returning to the setup card. */}
        <div className="home-actions">
          <Link className="primary first-only" href="/setup/chat">
            Get started
          </Link>
          <Link className="primary returning-only" href="/setup">
            Get started
          </Link>
        </div>
      </section>

      <section className="home-media">
        <HomeVideo />
      </section>
    </main>
    </>
  );
}
