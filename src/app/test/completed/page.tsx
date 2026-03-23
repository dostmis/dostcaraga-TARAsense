import Link from "next/link";
import { PageShell, SurfaceCard } from "@/components/ui/page-shell";

type PageProps = {
  searchParams: Promise<{ studyId?: string }>;
};

export default async function TestCompletedPage({ searchParams }: PageProps) {
  const { studyId } = await searchParams;

  return (
    <PageShell maxWidthClassName="max-w-md">
      <SurfaceCard className="p-8 text-center">
        <h1 className="text-2xl font-bold text-[#0f172a]">Response submitted</h1>
        <p className="mt-3 text-[#64748b]">Thank you for completing the sensory test.</p>

        <div className="mt-6 flex flex-col gap-3">
          {studyId && (
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
