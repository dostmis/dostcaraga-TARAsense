/**
 * Pure session constants with no runtime dependencies, so they can be imported
 * from both the Node session helpers (session-token.ts) and the Edge-runtime
 * middleware verifier (session-token-edge.ts) without pulling in `node:crypto`.
 */

export const SESSION_TOKEN_COOKIE_KEY = "tara_session";

/** Default absolute lifetime for a session token. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
/** Shorter absolute lifetime for privileged (ADMIN) sessions. */
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
/**
 * Sliding inactivity window. The middleware re-issues the token on each request
 * with exp = min(now + this, abs); once a token goes unused for longer than
 * this, it expires on its own (idle timeout).
 */
export const SESSION_IDLE_TTL_SECONDS = 60 * 30; // 30 minutes

/** Minimum length enforced for SESSION_SECRET / other signing secrets. */
export const MIN_SECRET_LENGTH = 32;
