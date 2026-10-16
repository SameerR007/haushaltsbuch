import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";
import { redactSecrets, setTraceProcessor, tracingEnabled } from "./langfuse";

const REGISTERED_KEY = "__haushaltsbuchLangfuseRegistered";

/**
 * Called once from instrumentation.ts on the Node.js runtime. Does nothing
 * unless the Langfuse keys are set. Dev reloads do not register twice.
 */
export function registerLangfuse(): void {
  if (!tracingEnabled()) return;
  const flags = globalThis as Record<string, unknown>;
  if (flags[REGISTERED_KEY]) return;
  flags[REGISTERED_KEY] = true;

  const processor = new LangfuseSpanProcessor({
    mask: ({ data }) => redactSecrets(data),
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || "local",
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  setTraceProcessor(processor);

  // Every generateText call (model calls, steps, tool calls) becomes Langfuse observations.
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}
