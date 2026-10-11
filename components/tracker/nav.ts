export type TrackerNavItem = {
  href: string;
  label: string;
  external?: boolean;
};

/** Expenses, then Chat, then Summary. Insights stays last and opens in a new window. */
export const TRACKER_NAV: readonly TrackerNavItem[] = [
  { href: "/app/expenses", label: "Expenses" },
  { href: "/app", label: "Chat" },
  { href: "/app/summary", label: "Summary" },
  { href: "/app/insights", label: "Insights ↗", external: true },
];

/** Where Open tracker lands: the first tab. */
export const TRACKER_HOME = TRACKER_NAV[0]?.href ?? "/app/expenses";

/** Chat is only the exact /app path, so Expenses and Summary do not light it up. */
export function isTrackerNavActive(pathname: string, item: TrackerNavItem): boolean {
  if (item.href === "/app") return pathname === "/app";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
