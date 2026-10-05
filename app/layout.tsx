import type { Metadata } from "next";
import { CONNECTION_STORAGE_KEY } from "@/lib/connection";
import "./globals.css";

/**
 * Blocking head script so the returning state is set before first paint.
 * Must stay in sync with hasSavedConnection(): any non-empty value counts.
 */
const visitStateScript = `try{var v=localStorage.getItem(${JSON.stringify(
  CONNECTION_STORAGE_KEY,
)});if(v)document.documentElement.dataset.visit="returning";}catch(e){}`;

export const metadata: Metadata = {
  title: "Haushaltsbuch",
  description:
    "Track spending in plain language. Your data stays in your Supabase project — the app runs on your machine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: visitStateScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
