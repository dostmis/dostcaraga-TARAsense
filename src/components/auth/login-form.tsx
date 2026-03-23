"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

type LoginFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

export function LoginForm({ action }: LoginFormProps) {
  return (
    <form action={action} className="mt-6 space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium text-[#334155]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          className="app-input"
          required
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium text-[#334155]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="********"
          className="app-input"
          required
        />
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
      className="app-button-primary w-full py-2.5 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Signing in..." : "Continue to Dashboard"}
    </button>
  );
}

function PendingMessage() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <p className="flex items-center justify-center gap-2 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#ea580c]">
      <Loader2 size={14} className="animate-spin" />
      Securing your session and preparing your dashboard...
    </p>
  );
}
