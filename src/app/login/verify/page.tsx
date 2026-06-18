import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resendAdminOtp, verifyAdminOtp } from "@/app/actions/auth-actions";
import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";
import { VerifyOtpForm } from "@/components/auth/verify-otp-form";
import { TimedToast } from "@/components/ui/timed-toast";
import { MFA_PENDING_COOKIE_KEY, verifyMfaPendingToken } from "@/lib/auth/mfa";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
};

function decodeFeedback(value: string) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

export default async function VerifyOtpPage({ searchParams }: PageProps) {
  const { error, message, next } = await searchParams;
  const redirectTo = next && next.startsWith("/") && !next.startsWith("//") ? next : ROLE_DASHBOARD_PATH.ADMIN;

  // Already fully authenticated → no second factor needed.
  const currentRole = await getCurrentRole();
  if (currentRole) {
    redirect(ROLE_DASHBOARD_PATH[currentRole]);
  }

  // A valid MFA-pending cookie is required to be on this page.
  const store = await cookies();
  const pending = verifyMfaPendingToken(store.get(MFA_PENDING_COOKIE_KEY)?.value ?? "");
  if (!pending) {
    redirect(`/login?error=${encodeURIComponent("Please sign in to continue.")}`);
  }

  return (
    <div className="relative grid min-h-screen w-full grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-2">
      <AuthBrandPanel
        headline={["Verify It's", "Really You."]}
        body="Admin accounts use a one-time email code as a second layer of protection for sensitive data."
      />

      <section className="flex min-h-screen items-stretch justify-center p-0 sm:items-center sm:p-8">
        <div className="glass-panel mobile-fullscreen-panel auth-fade-in w-full max-w-md p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:p-10">
          <Link href="/" className="mb-7 inline-flex max-w-full items-center gap-2 rounded-full border border-divider/70 bg-surface/80 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-soft backdrop-blur transition-all hover:border-brand/40 hover:text-foreground lg:hidden">
            TARAsense
          </Link>

          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">Two-step verification</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              Enter the code we sent to your email to finish signing in.
            </p>
          </div>

          {error && (
            <div className="mt-6">
              <TimedToast variant="error" title="Verification failed" message={decodeFeedback(error)} durationMs={4000} />
            </div>
          )}

          {message && (
            <div className="mt-6">
              <TimedToast variant="success" title="Check your email" message={decodeFeedback(message)} durationMs={4000} />
            </div>
          )}

          <VerifyOtpForm verifyAction={verifyAdminOtp} resendAction={resendAdminOtp} redirectTo={redirectTo} />

          <p className="mt-7 text-center text-sm text-muted-foreground">
            Entered the wrong account?{" "}
            <Link href="/login" className="link-accent font-medium text-brand hover:text-brand">
              Back to sign in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
