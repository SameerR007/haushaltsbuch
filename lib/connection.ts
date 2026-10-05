/**
 * localStorage key for a saved household connection.
 *
 * Read on the landing page (see `app/layout.tsx`) before first paint:
 * - missing or empty → first visit: “Get started” only
 * - any non-empty string → returning: “Open tracker” and “Set up again”
 *
 * Setup does not exist yet, so nothing in the app writes this key.
 * Preview the returning screen with:
 *
 *   localStorage.setItem("haushaltsbuch.connection", "1")
 *
 * Clear it with `localStorage.removeItem("haushaltsbuch.connection")`.
 */
export const CONNECTION_STORAGE_KEY = "haushaltsbuch.connection";

/** True when `value` is a non-empty connection marker. */
export function hasSavedConnection(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}
