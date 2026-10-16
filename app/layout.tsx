import type { Metadata } from "next";
import { connection } from "next/server";
import { CHAT_BOOT_STORAGE_KEY, serverBootId } from "@/lib/chat/boot";
import { CHAT_STORAGE_KEY } from "@/lib/chat/persist";
import { CONNECTION_STORAGE_KEY } from "@/lib/connection";
import "./globals.css";

/**
 * Blocking head script so the returning state is set before first paint.
 * Must stay in sync with hasSavedConnection(): any non-empty value counts.
 */
const visitStateScript = `try{var v=localStorage.getItem(${JSON.stringify(
  CONNECTION_STORAGE_KEY,
)});if(v)document.documentElement.dataset.visit="returning";}catch(e){}`;

/**
 * Blocking head script so the chat starts empty after the server restarts. Runs before the chat
 * reads its saved transcript; switching tabs within one server run keeps it.
 */
function chatBootScript(bootId: string): string {
  return `try{var k=${JSON.stringify(CHAT_BOOT_STORAGE_KEY)},b=${JSON.stringify(
    bootId,
  )};if(localStorage.getItem(k)!==b){localStorage.removeItem(${JSON.stringify(
    CHAT_STORAGE_KEY,
  )});localStorage.setItem(k,b);}}catch(e){}`;
}

export const metadata: Metadata = {
  title: "Haushaltsbuch",
  description:
    "Track spending in plain language. Your money stays in a database on this computer.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Render per request, so the boot id is this run's and not one baked in at build time.
  await connection();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: visitStateScript }} />
        <script dangerouslySetInnerHTML={{ __html: chatBootScript(serverBootId()) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
