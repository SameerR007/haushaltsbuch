export type TrackerNavItem = {
  href: string;
  label: string;
  external?: boolean;
};

/** Home, then Expenses, Chat, and Summary. Insights stays last and opens in a new window. */
export const TRACKER_NAV: readonly TrackerNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/app/expenses", label: "Expenses" },
  { href: "/app", label: "Chat" },
  { href: "/app/summary", label: "Summary" },
  { href: "/app/insights", label: "Insights ↗", external: true },
];

/** Where Open tracker lands. Home in the nav is the welcome screen, not this path. */
export const TRACKER_HOME = "/app/expenses";

/**
 * Home matches only the welcome screen. Chat is only the exact /app path,
 * so Expenses and Summary do not light it up.
 */
export function isTrackerNavActive(pathname: string, item: TrackerNavItem): boolean {
  if (item.href === "/" || item.href === "/app") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
