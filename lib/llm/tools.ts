import { jsonSchema, tool } from "ai";
import { proposedArgsValid } from "./rows-schema";

/** How the household database is laid out. Sent with run_sql so the model does not guess column names. */
export const SQL_SCHEMA_NOTE =
  "Tables: transactions(id, date TEXT as YYYY-MM-DD, category TEXT, amount REAL signed with expenses negative and income positive, bank TEXT, notes TEXT holding the payee or description, batch_id TEXT); categories(name); banks(name, initials, active 1 or 0, removed_at). There is no description column; use notes.";

/** Tool results sent back to the model are cut at this many JSON characters. */
export const TOOL_OUTPUT_CAP = 80_000;

const INVALID_ARGUMENTS = { __invalidArguments: true };

export type ToolHandler = (name: string, args: unknown) => unknown | Promise<unknown>;

export function invalidArgumentsInput(): string {
  return JSON.stringify(INVALID_ARGUMENTS);
}

export function isInvalidArguments(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { __invalidArguments?: unknown };
  return record.__invalidArguments === true && Object.keys(record).length === 1;
}

function sqlShape(value: unknown): boolean {
  if (isInvalidArguments(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { query?: unknown }).query === "string";
}

function proposeShape(value: unknown): boolean {
  if (isInvalidArguments(value)) return true;
  return proposedArgsValid(value);
}

const ROW_KEYS = ["date", "description", "category", "bank", "amount", "uncertain"] as const;

/**
 * A model sometimes writes a row key in the wrong case ("Date" for "date"). Rename such keys so
 * one capital letter does not throw away the whole proposal. Returns null when nothing changed
 * or the input is still not a valid proposal.
 */
export function normalizeProposeInput(input: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { rows?: unknown }).rows)) return null;
  let changed = false;
  const rows = (parsed as { rows: unknown[] }).rows.map((row) => {
    if (typeof row !== "object" || row === null) return row;
    const fixed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const known = ROW_KEYS.find((name) => name === key.toLowerCase());
      if (known && known !== key && !(known in row)) {
        fixed[known] = value;
        changed = true;
      } else {
        fixed[key] = value;
      }
    }
    return fixed;
  });
  if (!changed) return null;
  const next = { ...(parsed as object), rows };
  return proposedArgsValid(next) ? JSON.stringify(next) : null;
}

/** True when the tool input should be repaired. Valid JSON of the right shape is fine. */
export function argumentsLookWrong(name: string, input: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return true;
  }
  if (name === "run_sql") return !sqlShape(parsed);
  if (name === "propose_transactions") return !proposeShape(parsed);
  return false;
}

function schemaOptions(validate: ((value: unknown) => boolean) | undefined) {
  if (!validate) return undefined;
  return {
    validate: (value: unknown) =>
      validate(value)
        ? { success: true as const, value }
        : { success: false as const, error: new Error("invalid") },
  };
}

const SQL_PARAMETERS = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    query: {
      type: "string" as const,
      description: "A single SELECT or WITH … SELECT statement.",
    },
  },
  required: ["query"],
};

const PROPOSE_PARAMETERS = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    rows: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          date: { type: "string" as const, description: "YYYY-MM-DD" },
          description: { type: "string" as const },
          category: { type: "string" as const },
          bank: { type: "string" as const },
          amount: {
            type: "number" as const,
            description: "Signed. Expenses negative, income positive.",
          },
          uncertain: { type: "boolean" as const },
        },
        required: ["date", "description", "category", "bank", "amount", "uncertain"],
      },
    },
  },
  required: ["rows"],
};

function capToolOutput(result: unknown): unknown {
  const value = result ?? { ok: false, error: "The tool returned nothing." };
  const serialized = JSON.stringify(value);
  if (serialized.length <= TOOL_OUTPUT_CAP) return value;
  return serialized.slice(0, TOOL_OUTPUT_CAP);
}

/**
 * `run_sql` and `propose_transactions`. Schemas are the current JSON schemas
 * (`jsonSchema`, not Zod). SQL guarding and row checks stay in the caller.
 * A bad argument or a thrown tool becomes `{ ok: false, error }` for the model.
 */
export function createChatTools(options: {
  executeTool: ToolHandler;
  onPropose: (args: unknown) => void;
  validateShape?: boolean;
}) {
  const run = async (name: string, args: unknown) => {
    if (args === null || isInvalidArguments(args)) {
      return { ok: false, error: "The arguments were not valid JSON." };
    }
    if (name === "propose_transactions") options.onPropose(args);
    try {
      return capToolOutput(await options.executeTool(name, args));
    } catch {
      return { ok: false, error: "The tool failed." };
    }
  };

  return {
    run_sql: tool({
      description:
        `Run one read-only SELECT or WITH query against the household SQLite database. Call this before stating any amount, total, balance, or count. Results are capped at about 200 rows. ${SQL_SCHEMA_NOTE}`,
      inputSchema: jsonSchema(SQL_PARAMETERS, schemaOptions(options.validateShape ? sqlShape : undefined)),
      strict: true,
      execute: async (input) => run("run_sql", input),
    }),
    propose_transactions: tool({
      description:
        "Propose transactions for the user to review. This does not save anything. Amounts are signed: expenses negative, income positive. A bank statement or ledger includes every row, expenses and income, even when the user says expenses or spending. Set uncertain to true when a field is unclear.",
      inputSchema: jsonSchema(
        PROPOSE_PARAMETERS,
        schemaOptions(options.validateShape ? proposeShape : undefined),
      ),
      strict: true,
      execute: async (input) => run("propose_transactions", input),
    }),
  };
}
