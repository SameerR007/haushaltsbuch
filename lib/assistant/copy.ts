/** Plain-language Test connection copy. The setup screens use these sentences as written. */

export const DEFAULT_LOCAL_ADDRESS = "http://localhost:11434";
export const DEFAULT_LOCAL_MODEL = "qwen3.5:9b";
export const LM_STUDIO_ADDRESS = "http://localhost:1234";
export const SMALLER_LOCAL_MODEL = "qwen3.5:4b";

/** Ollama is asked for this context window on each local turn. */
export const LOCAL_NUM_CTX = 8192;

/** A Test connection slower than this still counts as success and offers a smaller model. */
export const SLOW_PROBE_MS = 15_000;

export const CONNECTED_TITLE = "Connected.";
export const SLOW_TITLE = "Connected, but slow.";
export const OLLAMA_NOT_RUNNING_TITLE = "Ollama isn't running.";
export const OLLAMA_NOT_RUNNING_DETAIL = "Open the Ollama app and try again.";
export const MODEL_MISSING_TITLE = "Connected, but the model isn't downloaded.";
export const MODEL_MISSING_DETAIL = "Open Terminal and run this, then test again:";
export const NO_TOOLS_TITLE = "That model can't use tools.";
export const NO_TOOLS_DETAIL = "Pick qwen3.5:9b.";

export const ENDPOINT_UNREACHABLE_TITLE = "Couldn't reach that address.";
export const ENDPOINT_UNREACHABLE_DETAIL = "Check the URL and try again.";
export const ENDPOINT_MISSING_TITLE = "Connected, but that model isn't available there.";
export const ENDPOINT_MISSING_DETAIL = "Check the model name your service lists, then test again.";
export const ENDPOINT_NO_TOOLS_TITLE = "That model can't use tools.";
export const ENDPOINT_NO_TOOLS_DETAIL = "Pick a model that can call tools.";
export const ENDPOINT_KEY_TITLE = "That key was refused.";
export const ENDPOINT_KEY_DETAIL = "Check it and try again.";

export const LOCAL_IMPORT_SOON =
  "Statement import on this computer is coming soon. You can still add expenses by typing.";

export function modelAnswerName(model: string): string {
  if (/^qwen3\.5\b/i.test(model.trim())) return "Qwen3.5";
  return model.trim();
}

export function formatSeconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

export function answeredDetail(kind: "local" | "endpoint", model: string, seconds: string): string {
  if (kind === "endpoint") return `The model answered in ${seconds} s.`;
  return `${modelAnswerName(model)} answered in ${seconds} s.`;
}

export function slowDetail(kind: "local" | "endpoint", model: string, seconds: string): string {
  const answered = answeredDetail(kind, model, seconds);
  if (kind === "endpoint") return `${answered} You can continue with this one.`;
  return `${answered} A smaller model such as ${SMALLER_LOCAL_MODEL} is faster, but its answers are less reliable. You can continue with this one.`;
}

export function pullCommand(model: string): string {
  return `ollama pull ${model.trim()}`;
}

export function endpointHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}
