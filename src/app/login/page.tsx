import Link from "next/link";
import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth-actions";
import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";
import { LoginForm } from "@/components/auth/login-form";
import { TimedToast } from "@/components/ui/timed-toast";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
};

function decodeFeedback(value: string) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { error, message, next } = await searchParams;
  const redirectTo = resolveAuthRedirectTarget(next);
  const currentRole = await getCurrentRole();
  if (currentRole) {
    redirect(resolveCurrentSessionRedirect(currentRole, redirectTo));
  }

  return (
    <div className="relative grid min-h-screen w-full grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-2">
      <AuthBrandPanel
        headline={["Build Your Team", "On Real Data."]} 
        body="Turn real consumer signals into smarter decisions, faster opportunities, and better team alignment."
      />

      <section className="flex min-h-screen items-stretch justify-center p-0 sm:items-center sm:p-8">
        <div className="glass-panel mobile-fullscreen-panel auth-fade-in w-full max-w-md p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:p-10">
          <Link href="/" className="mb-7 inline-flex max-w-full items-center gap-2 rounded-full border border-divider/70 bg-surface/80 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-soft backdrop-blur transition-all hover:border-brand/40 hover:text-foreground lg:hidden">
            TARAsense
          </Link>

          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">TARAsense</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">Log in to TARAsense</p>
          </div>

          {error && (
            <div className="mt-6">
              <TimedToast variant="error" title="Sign-in failed" message={decodeFeedback(error)} durationMs={3000} />
            </div>
          )}

          {message && (
            <div className="mt-6">
              <TimedToast
                variant="success"
                title="System Message"
                message={decodeFeedback(message)}
                durationMs={3000}
              />
            </div>
          )}

          <LoginForm action={login} redirectTo={redirectTo} />

          <p className="mt-7 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href={`/register?next=${encodeURIComponent(redirectTo)}`} className="link-accent font-medium text-brand hover:text-brand">
              Create one
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

function resolveAuthRedirectTarget(value: string | undefined) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return ROLE_DASHBOARD_PATH.CONSUMER;
}

function resolveCurrentSessionRedirect(role: keyof typeof ROLE_DASHBOARD_PATH, redirectTo: string) {
  if (role === "CONSUMER") {
    return redirectTo;
  }
  if (role === "MSME" && /^\/studies\/[^/]+\/start(?:\?|$)/.test(redirectTo)) {
    return redirectTo;
  }
  return ROLE_DASHBOARD_PATH[role];
}
