"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isTrackerNavActive, TRACKER_NAV } from "@/components/tracker/nav";

/** The page links shown top right on Home, Setup, and the tracker. */
export function SiteNav({ className }: { className?: string }) {
  const pathname = usePathname() || "/";
  return (
    <nav className={className ? `site-nav ${className}` : "site-nav"} aria-label="Pages">
      {TRACKER_NAV.map((item) =>
        item.external ? (
          <a
            key={item.href}
            className={isTrackerNavActive(pathname, item) ? "is-active" : undefined}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Insights, opens in a new window"
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={item.href}
            className={isTrackerNavActive(pathname, item) ? "is-active" : undefined}
            href={item.href}
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}
