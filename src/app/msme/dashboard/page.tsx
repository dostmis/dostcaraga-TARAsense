import { MsmeDashboard } from "@/components/dashboards/msme-dashboard";
import { getCurrentSession, requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ view?: string; error?: string; message?: string; q?: string }>;
};

export default async function MsmeDashboardPage({ searchParams }: PageProps) {
  await requireRole(["MSME", "ADMIN"]);
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const params = await searchParams;
  return <MsmeDashboard userId={session.userId} view={params.view} error={params.error} message={params.message} q={params.q} />;
}
