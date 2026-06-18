import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Origins permitted to invoke Server Actions (CSRF defense-in-depth on top of
 * the SameSite=lax session cookie). Same-origin is always allowed; list any
 * additional production hosts here or via SERVER_ACTION_ALLOWED_ORIGINS
 * (comma-separated host[:port], no scheme).
 */
const serverActionAllowedOrigins = [
  "tarasense.dostcaraga.ph",
  ...(process.env.SERVER_ACTION_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];

/**
 * Security response headers applied to every route. HSTS is only honored by
 * browsers over HTTPS (ignored on http://localhost), so it is safe in dev.
 *
 * The CSP here intentionally contains only directives that cannot break
 * resource loading (no script-src/style-src), so it is safe to enforce on the
 * existing app. A nonce-based script-src/style-src policy is the recommended
 * next hardening step and should be rolled out via Content-Security-Policy-
 * Report-Only first to catch violations from the embedded chat widget.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactCompiler: !isDevelopment,
  experimental: {
    serverActions: {
      allowedOrigins: serverActionAllowedOrigins,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
