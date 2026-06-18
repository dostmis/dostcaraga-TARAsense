"use client";

import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useFormStatus } from "react-dom";

type VerifyOtpFormProps = {
  verifyAction: (formData: FormData) => void | Promise<void>;
  resendAction: (formData: FormData) => void | Promise<void>;
  redirectTo?: string;
};

export function VerifyOtpForm({ verifyAction, resendAction, redirectTo = "" }: VerifyOtpFormProps) {
  return (
    <>
      <form action={verifyAction} className="mt-6 space-y-5">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <div className="space-y-2">
          <label htmlFor="code" className="text-sm font-medium text-foreground">
            Verification code
          </label>
          <div className="app-icon-input">
            <span className="app-icon-input__icon">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              className="app-icon-input__control tracking-[0.5em]"
              autoFocus
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Enter the 6-digit code we emailed you. It expires in a few minutes.
          </p>
        </div>

        <SubmitButton />
      </form>

      <form action={resendAction} className="mt-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <ResendButton />
      </form>
    </>
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
      {pending ? "Verifying..." : "Verify and continue"}
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
    </button>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="link-accent inline-flex w-full items-center justify-center gap-2 text-sm text-brand disabled:cursor-not-allowed disabled:opacity-70"
    >
      <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Sending a new code..." : "Resend code"}
    </button>
  );
}
