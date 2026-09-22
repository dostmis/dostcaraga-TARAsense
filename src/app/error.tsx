"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * App-wide error boundary. Without this, any client-side exception — including a
 * Server Action whose response never reaches the app (an edge/proxy block returns
 * HTML where an RSC payload is expected) — renders Next's bare "Application error"
 * screen with no way back. Show the user something actionable instead.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the browser console for support; the server logs its own copy
    // whenever the failure actually reached the origin.
    console.error("TARAsense app error:", error);
  }, [error]);

  // A rejected Server Action request reads as a malformed response rather than a
  // thrown app error, so point at the network instead of blaming their input.
  const isBlockedRequest = /unexpected response|Failed to fetch|NetworkError/i.test(error.message);

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="app-card w-full max-w-md space-y-4 p-8 text-center">
        <h1 className="text-xl font-semibold text-[#0f172a]">Something went wrong</h1>
        <p className="text-sm leading-6 text-[#64748b]">
          {isBlockedRequest
            ? "Your request didn't reach our servers. This is usually a temporary network or security-filter issue — please try again, and if it keeps happening, contact your TARAsense administrator."
            : "We hit an unexpected problem loading this page. Please try again."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset} className="app-button-primary px-4 py-2 text-sm">
            Try again
          </button>
          <Link href="/" className="app-button-secondary px-4 py-2 text-sm">
            Back to home
          </Link>
        </div>
        {error.digest ? (
          <p className="text-xs text-[#94a3b8]">
            Reference code: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
