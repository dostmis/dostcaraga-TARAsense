"use client";

import Link from "next/link";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { useFormStatus } from "react-dom";

type LoginFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

export function LoginForm({ action }: LoginFormProps) {
  return (
    <form action={action} className="mt-6 space-y-5">
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-divider/70 bg-surface px-4 py-3 text-sm font-semibold text-foreground shadow-soft transition-all hover:border-brand/25 hover:shadow-panel"
        aria-label="Continue with Google"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-divider" />
        <span className="text-xs text-muted-foreground">or continue with email</span>
        <div className="h-px flex-1 bg-divider" />
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <div className="flex min-h-12 items-center rounded-xl border border-input bg-card text-foreground transition focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_24%,transparent)]">
          <span className="flex w-12 shrink-0 items-center justify-center text-muted-foreground">
            <Mail className="h-4 w-4" />
          </span>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            className="min-h-12 min-w-0 flex-1 border-0 bg-transparent py-2.5 pr-4 text-base text-foreground outline-none placeholder:text-muted-foreground"
            autoComplete="email"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <div className="flex min-h-12 items-center rounded-xl border border-input bg-card text-foreground transition focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_24%,transparent)]">
          <span className="flex w-12 shrink-0 items-center justify-center text-muted-foreground">
            <Lock className="h-4 w-4" />
          </span>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            className="min-h-12 min-w-0 flex-1 border-0 bg-transparent py-2.5 pr-4 text-base text-foreground outline-none placeholder:text-muted-foreground"
            autoComplete="current-password"
            required
          />
        </div>
      </div>

      <div className="flex items-center justify-end">
        <Link
          href="/login?message=Please+contact+your+administrator+to+reset+your+password"
          className="link-accent text-sm text-brand"
        >
          Forgot password?
        </Link>
      </div>

      <SubmitButton />
      <PendingMessage />
    </form>
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-hero btn-xl w-full disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Signing in..." : "Sign in"}
      {!pending && <ArrowRight className="h-4 w-4" />}
    </button>
  );
}

function PendingMessage() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <p className="flex items-center justify-center gap-2 rounded-[1rem] border border-divider/70 bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
      <Loader2 size={14} className="animate-spin" />
      Securing your session and preparing your dashboard...
    </p>
  );
}
