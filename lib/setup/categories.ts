/** Default categories seeded into the local database. Not money rows. */
export const EXPECTED_CATEGORIES = [
  "food",
  "rent",
  "household",
  "grocery",
  "bill",
  "miscellaneous",
  "salary",
] as const;

export function hasExpectedCategories(names: readonly string[]): boolean {
  const found = new Set(names);
  return EXPECTED_CATEGORIES.every((name) => found.has(name));
}
