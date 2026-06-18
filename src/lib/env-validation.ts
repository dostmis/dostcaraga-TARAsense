/**
 * Boot-time secret validation. Invoked from instrumentation.ts so the server
 * fails fast (in production) when a signing secret is missing, too short, or
 * left at a known example/placeholder value — the failure mode that lets
 * sessions or mobile JWTs be forged.
 *
 * In development the same problems are logged as warnings instead of throwing,
 * so local work isn't blocked.
 */

type Severity = "required" | "recommended";

interface SecretRule {
  name: string;
  minLength: number;
  severity: Severity;
}

/** Values shipped in .env.example (or otherwise obviously insecure). */
const WEAK_VALUES = new Set([
  "TARAsenseisthenewmeta",
  "TARAsensenumber1",
  "replace-with-long-random-secret",
  "changeme",
  "secret",
  "password",
]);

const SECRET_RULES: SecretRule[] = [
  // Forging either of these breaks authentication outright, so they are hard
  // requirements in production.
  { name: "SESSION_SECRET", minLength: 32, severity: "required" },
  { name: "MOBILE_TOKEN_SECRET", minLength: 32, severity: "required" },
  // Only gates the cron endpoints, which already refuse to run when unset — a
  // shortfall here shouldn't take down the whole app, so it's a warning.
  { name: "CRON_SECRET", minLength: 32, severity: "recommended" },
];

const GENERATION_HINT =
  'Generate strong values with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';

function problemsFor(rule: SecretRule): string[] {
  const value = (process.env[rule.name] ?? "").trim();
  const problems: string[] = [];
  if (!value) {
    problems.push("is not set");
    return problems;
  }
  if (value.length < rule.minLength) {
    problems.push(`must be at least ${rule.minLength} characters (currently ${value.length})`);
  }
  if (WEAK_VALUES.has(value)) {
    problems.push("matches a known example/placeholder value and must be replaced");
  }
  return problems;
}

export function validateSecrets(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of SECRET_RULES) {
    const problems = problemsFor(rule);
    if (problems.length === 0) {
      continue;
    }
    const message = `${rule.name} ${problems.join("; ")}.`;
    if (rule.severity === "required") {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  for (const warning of warnings) {
    console.warn(`[env] WARNING: ${warning}`);
  }

  if (errors.length > 0) {
    const detail = errors.map((error) => ` - ${error}`).join("\n");
    const message = `Insecure secret configuration detected:\n${detail}\n${GENERATION_HINT}`;
    if (isProduction) {
      throw new Error(`[env] Refusing to start. ${message}`);
    }
    console.warn(`[env] ${message}`);
  }
}
