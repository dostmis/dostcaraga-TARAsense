/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * Used to fail fast on insecure secret configuration before serving traffic.
 */
export async function register() {
  // Only run on the Node.js server runtime (not the Edge runtime), where the
  // signing secrets are actually read.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateSecrets } = await import("@/lib/env-validation");
    validateSecrets();
  }
}
