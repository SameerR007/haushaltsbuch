import Link from "next/link";

export default function Home() {
  return (
    <main className="card">
      <p className="eyebrow">Local · Private</p>
      <h1>Welcome to Haushaltsbuch</h1>
      <p className="lede">
        Track spending in plain language. Your money stays in a database on
        this computer — the app runs on your machine.
      </p>
      <div className="actions">
        <Link className="primary first-only" href="/setup">
          Get started
        </Link>
        <Link className="primary returning-only" href="/app">
          Open tracker
        </Link>
        <Link className="linkish returning-only" href="/setup">
          Set up again
        </Link>
      </div>
      <p className="foot first-only">
        We’ll walk you through an OpenAI key, currency (default €), and your banks.
      </p>
      <p className="foot returning-only">
        Welcome back — pick up where you left off.
      </p>
      <div className="pills">
        <span className="pill">Default €</span>
        <span className="pill">Chat + summary</span>
        <span className="pill">On this computer</span>
      </div>
    </main>
  );
}
