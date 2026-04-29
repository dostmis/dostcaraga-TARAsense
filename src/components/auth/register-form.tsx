"use client";

import Link from "next/link";
import { ArrowRight, Building2, Loader2, Lock, Mail, User } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

type RegisterFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

const passwordChecks: Array<{ match: RegExp; label: string }> = [
  { match: /.{8,}/, label: "8+ characters" },
  { match: /[A-Z]/, label: "Uppercase letter" },
  { match: /[a-z]/, label: "Lowercase letter" },
  { match: /[0-9]/, label: "Number" },
];

export function RegisterForm({ action }: RegisterFormProps) {
  const [password, setPassword] = useState("");

  return (
    <form action={action} className="mt-6 space-y-5">
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          Full Name
        </label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input id="name" name="name" placeholder="Jane Doe" required className="app-input pl-10" autoComplete="name" />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="organization" className="text-sm font-medium text-foreground">
          Organization <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </label>
        <div className="relative">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input id="organization" name="organization" placeholder="Acme Corp" className="app-input pl-10" autoComplete="organization" />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input id="email" name="email" type="email" placeholder="you@company.com" required className="app-input pl-10" autoComplete="email" />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Create a strong password"
            minLength={8}
            required
            className="app-input pl-10"
            autoComplete="new-password"
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </div>
      </div>

      <div className="border-t border-divider/70 pt-3">
        <div className="flex flex-wrap gap-2">
          {passwordChecks.map((item) => {
            const valid = item.match.test(password);
            return (
              <span
                key={item.label}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                  valid
                    ? "border-surface/40 bg-surface text-foreground shadow-soft"
                    : "border-divider bg-surface-muted text-muted-foreground"
                }`}
              >
                <span className={`flex h-1.5 w-1.5 rounded-full ${valid ? "bg-support" : "bg-divider"}`} />
                {item.label}
              </span>
            );
          })}
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-6 text-muted-foreground">
        <input
          name="terms"
          type="checkbox"
          required
          className="mt-1 h-4 w-4 rounded border-divider text-brand accent-[var(--brand)]"
        />
        <span>
          I agree to{" "}
          <Link href="/#footer" className="link-accent font-medium text-foreground">
            Terms &amp; Conditions
          </Link>
        </span>
      </label>

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
      {pending ? "Creating account..." : "Create account"}
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
      Creating your profile and loading your workspace...
    </p>
  );
}
