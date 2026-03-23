"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

type RegisterFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

export function RegisterForm({ action }: RegisterFormProps) {
  return (
    <form action={action} className="mt-6 space-y-4">
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium text-[#334155]">
          Full Name
        </label>
        <input id="name" name="name" required className="app-input" />
      </div>

      <div className="space-y-1">
        <label htmlFor="organization" className="text-sm font-medium text-[#334155]">
          Organization (Optional)
        </label>
        <input id="organization" name="organization" className="app-input" />
      </div>

      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium text-[#334155]">
          Email
        </label>
        <input id="email" name="email" type="email" required className="app-input" />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium text-[#334155]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          required
          className="app-input"
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
      {pending ? "Creating account..." : "Register as Consumer"}
    </button>
  );
}

function PendingMessage() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <p className="flex items-center justify-center gap-2 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#ea580c]">
      <Loader2 size={14} className="animate-spin" />
      Creating your profile and loading your workspace...
    </p>
  );
}
