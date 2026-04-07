import Link from "next/link";
import { PageShell, SurfaceCard } from "@/components/ui/page-shell";
import { getCurrentGuestSession, getCurrentSession } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ studyId?: string }>;
};

export default async function TestCompletedPage({ searchParams }: PageProps) {
  const { studyId } = await searchParams;
  const session = await getCurrentSession();
  const guestSession = await getCurrentGuestSession();
  const canOpenDashboard = Boolean(studyId && session && session.role !== "CONSUMER");
  const isGuest = !session && Boolean(guestSession);

  return (
    <PageShell maxWidthClassName="max-w-md">
      <SurfaceCard className="p-8 text-center">
        <h1 className="text-2xl font-bold text-[#0f172a]">Response submitted</h1>
        <p className="mt-3 text-[#64748b]">Thank you for completing the sensory test.</p>
        {isGuest && <p className="mt-2 text-sm text-[#64748b]">Your walk-in guest response has been recorded.</p>}

        <div className="mt-6 flex flex-col gap-3">
          {canOpenDashboard && (
            <Link
              href={`/dashboard/${studyId}`}
              className="app-button-primary inline-flex items-center justify-center px-4 py-3"
            >
              View Study Dashboard
            </Link>
          )}
          <Link
            href="/"
            className="app-button-secondary inline-flex items-center justify-center px-4 py-3"
          >
            Return Home
          </Link>
        </div>
      </SurfaceCard>
    </PageShell>
  );
}
