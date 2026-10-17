import { z } from "zod";

/** One proposed row. The local and endpoint turns check this before the tool runs. */
export const proposedRowSchema = z.object({
  date: z.string(),
  description: z.string(),
  category: z.string(),
  bank: z.string(),
  amount: z.number(),
  uncertain: z.boolean(),
});

export const proposedArgsSchema = z.object({
  rows: z.array(proposedRowSchema),
});

export function proposedArgsValid(value: unknown): boolean {
  return proposedArgsSchema.safeParse(value).success;
}
