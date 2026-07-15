"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useFormStatus } from "react-dom";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

type LoginFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  redirectTo?: string;
};

export function LoginForm({ action, redirectTo = "" }: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="mt-6 space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <GoogleSignInButton redirectTo={redirectTo} />

      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-divider" />
        <span className="text-xs text-muted-foreground">or continue with email</span>
        <div className="h-px flex-1 bg-divider" />
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <div className="app-icon-input">
          <span className="app-icon-input__icon">
            <Mail className="h-4 w-4" />
          </span>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            className="app-icon-input__control"
            autoComplete="email"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <div className="app-icon-input">
          <span className="app-icon-input__icon">
            <Lock className="h-4 w-4" />
          </span>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            className="app-icon-input__control"
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="app-icon-input__icon cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            title={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="remember"
            className="h-4 w-4 cursor-pointer rounded border-divider accent-[#f97316]"
          />
          Remember this device
        </label>
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
