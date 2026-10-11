import { jsonSchema, tool } from "ai";

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
        "Run one read-only SELECT or WITH query against the household SQLite database. Call this before stating any amount, total, balance, or count. Results are capped at about 200 rows.",
      inputSchema: jsonSchema(SQL_PARAMETERS),
      strict: true,
      execute: async (input) => run("run_sql", input),
    }),
    propose_transactions: tool({
      description:
        "Propose transactions for the user to review. This does not save anything. Amounts are signed: expenses negative, income positive. A bank statement or ledger includes every row, expenses and income, even when the user says expenses or spending. Set uncertain to true when a field is unclear.",
      inputSchema: jsonSchema(PROPOSE_PARAMETERS),
      strict: true,
      execute: async (input) => run("propose_transactions", input),
    }),
  };
}
