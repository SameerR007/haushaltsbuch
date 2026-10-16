/** Next.js startup hook. Langfuse tracing is optional; see "Tracing with Langfuse" in the README. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerLangfuse } = await import("./lib/tracing/register");
  registerLangfuse();
}
