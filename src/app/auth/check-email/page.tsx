import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";

type PageProps = {
  searchParams: Promise<{ email?: string }>;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default async function CheckEmailPage({ searchParams }: PageProps) {
  const { email } = await searchParams;
  const safeEmail = email && isValidEmail(email) ? email : null;

  return (
    <div className="relative grid min-h-screen w-full grid-cols-1 overflow-hidden bg-background text-foreground lg:grid-cols-2">
      <AuthBrandPanel
        headline={["Almost There.", "Check Your Inbox."]}
        body="We sent a secure confirmation link to finish setting up your TARAsense account."
      />

      <section className="flex min-h-screen items-stretch justify-center p-0 sm:items-center sm:p-8">
        <div className="glass-panel mobile-fullscreen-panel auth-fade-in w-full max-w-md p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:p-10">
          <Link
            href="/"
            className="mb-7 inline-flex max-w-full items-center gap-2 rounded-full border border-divider/70 bg-surface/80 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-soft backdrop-blur transition-all hover:border-brand/40 hover:text-foreground lg:hidden"
          >
            TARAsense
          </Link>

          <div className="flex flex-col items-center space-y-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
              <MailCheck className="h-7 w-7" />
            </span>
            <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">Confirm your email</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              We sent a confirmation link
              {safeEmail ? (
                <>
                  {" "}to <span className="font-semibold text-foreground">{safeEmail}</span>
                </>
              ) : (
                " to your Google email"
              )}
              . Open it and tap <span className="font-medium text-foreground">Confirm sign-in</span> to finish creating
              your account.
            </p>
          </div>

          <div className="mt-7 space-y-3 rounded-[1rem] border border-divider/70 bg-surface-muted px-4 py-3 text-xs leading-6 text-muted-foreground">
            <p>The link expires in 30 minutes. Can&apos;t find it? Check your spam or promotions folder.</p>
          </div>

          <Link href="/api/auth/google" className="btn-hero btn-xl mt-6 w-full justify-center">
            Resend confirmation link
          </Link>

          <p className="mt-7 text-center text-sm text-muted-foreground">
            Wrong account?{" "}
            <Link href="/login" className="link-accent font-medium text-brand hover:text-brand">
              Back to sign in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
