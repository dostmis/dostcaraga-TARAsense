import Link from "next/link";
import { redirect } from "next/navigation";
import { register } from "@/app/actions/auth-actions";
import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";
import { RegisterForm } from "@/components/auth/register-form";
import { TimedToast } from "@/components/ui/timed-toast";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

function decodeFeedback(value: string) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

export default async function RegisterPage({ searchParams }: PageProps) {
  const currentRole = await getCurrentRole();
  if (currentRole) {
    redirect(ROLE_DASHBOARD_PATH[currentRole]);
  }

  const { error, message } = await searchParams;

  return (
    <div className="relative grid min-h-screen w-full grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-2">
      <AuthBrandPanel
        headline={["Build Your Team", "On Real Data."]}
        body="Join TARAsense to access market signals that help your team stay ahead of consumer trends in real time."
      />

      <section className="flex min-h-screen items-center justify-center p-6 sm:p-8">
        <div className="glass-panel auth-fade-in w-full max-w-md p-8 sm:p-10">
          <Link href="/" className="mb-7 inline-flex items-center gap-2 rounded-full border border-divider/70 bg-surface/80 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-soft backdrop-blur transition-all hover:border-brand/40 hover:text-foreground lg:hidden">
            TARAsense
          </Link>

          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold text-foreground">Create account</h1>
            <p className="text-muted-foreground">Register for TARAsense to get started</p>
          </div>

          {error && (
            <div className="mt-6">
              <TimedToast
                variant="error"
                title="Registration failed"
                message={decodeFeedback(error)}
                durationMs={3000}
              />
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

          <RegisterForm action={register} />

          <p className="mt-7 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="link-accent font-medium text-brand hover:text-brand">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
