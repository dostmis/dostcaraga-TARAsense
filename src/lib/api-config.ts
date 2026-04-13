// Central API configuration for frontend services.
// If NEXT_PUBLIC_API_URL is unset, we default to same-origin Next.js API routes (/api/*).
const configuredBase = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");

export const API_BASE_URL = configuredBase;

export function buildApiUrl(pathUnderApi: string) {
  const normalized = pathUnderApi.startsWith("/") ? pathUnderApi : `/${pathUnderApi}`;
  if (API_BASE_URL) {
    return `${API_BASE_URL}${normalized}`;
  }
  return `/api${normalized}`;
}
