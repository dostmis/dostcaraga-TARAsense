"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

type GoogleSignInButtonProps = {
  /** Same-origin path to return to after a successful sign-in. */
  redirectTo?: string;
  label?: string;
};

/**
 * Kicks off the Google OAuth flow by navigating to the server route that
 * builds the consent URL. Reused on both the login and register pages so the
 * button styling and behaviour stay consistent.
 */
export function GoogleSignInButton({ redirectTo = "", label = "Continue with Google" }: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);

  const href = `/api/auth/google${redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ""}`;

  return (
    <button
      type="button"
      onClick={() => {
        setLoading(true);
        window.location.assign(href);
      }}
      disabled={loading}
      aria-label={label}
      className="flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-divider/70 bg-surface px-4 py-3 text-sm font-semibold text-foreground shadow-soft transition-all hover:border-brand/25 hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-70"
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <GoogleIcon />}
      {loading ? "Redirecting to Google…" : label}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.36 10.36 0 0 0 12 1 10.99 10.99 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
