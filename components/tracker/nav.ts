export type TrackerNavItem = {
  href: string;
  label: string;
  external?: boolean;
};

/** Home, Setup, then Expenses, Chat, and Summary. Insights stays last and opens in a new window. */
export const TRACKER_NAV: readonly TrackerNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/setup", label: "Setup" },
  { href: "/expenses", label: "Expenses" },
  { href: "/chat", label: "Chat" },
  { href: "/summary", label: "Summary" },
  { href: "/insights", label: "Insights ↗", external: true },
];

/** Where Open tracker lands. Home in the nav is the welcome screen, not this path. */
export const TRACKER_HOME = "/expenses";

/**
 * Home matches only the home page. The rest also match their sub-paths,
 * so Setup stays lit on the setup chat at /setup/chat.
 */
export function isTrackerNavActive(pathname: string, item: TrackerNavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
