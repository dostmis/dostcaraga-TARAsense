import Link from "next/link";
import { redirect } from "next/navigation";
import { Beaker } from "lucide-react";
import { register } from "@/app/actions/auth-actions";
import { RegisterForm } from "@/components/auth/register-form";
import { SystemAlert } from "@/components/ui/system-alert";
import { TimedToast } from "@/components/ui/timed-toast";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function RegisterPage({ searchParams }: PageProps) {
  const currentRole = await getCurrentRole();
  if (currentRole) {
    redirect(ROLE_DASHBOARD_PATH[currentRole]);
  }

  const { error, message } = await searchParams;

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      <section className="relative hidden bg-[#f97316] p-12 text-white lg:flex lg:items-center lg:justify-center">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15">
            <Beaker className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Join TARAsense</h1>
          <p className="mt-4 text-white/85">
            Create your account and start using structured sensory and market insights to improve food products.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center bg-[#f8fafc] p-6 sm:p-10">
        <div className="w-full max-w-sm rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-8">
          <Link href="/" className="mb-7 inline-flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f97316]">
              <Beaker className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-[#0f172a]">
              TARA<span className="text-[#f97316]">sense</span>
            </span>
          </Link>

          <h2 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Create account</h2>
          <p className="mt-2 text-sm text-[#64748b]">
            All new accounts are created as Consumer. You can apply for MSME or FIC access after registration.
          </p>

          {error && (
            <div className="mt-4">
              <TimedToast
                variant="error"
                title="Registration failed"
                message={decodeURIComponent(error)}
                durationMs={3000}
              />
            </div>
          )}

          {message && (
            <div className="mt-4">
              <TimedToast
                variant="success"
                title="System Message"
                message={decodeURIComponent(message)}
                durationMs={3000}
              />
            </div>
          )}

          {!error && !message && (
            <div className="mt-4">
              <SystemAlert
                variant="info"
                title="Registration Flow"
                message="After submitting, we automatically sign you in and redirect you to the Consumer dashboard."
              />
            </div>
          )}

          <RegisterForm action={register} />

          <div className="mt-5 text-sm">
            <Link href="/login" className="font-medium text-[#f97316] hover:text-[#ea580c]">
              Already have an account? Log in
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
