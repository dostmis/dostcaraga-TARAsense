import { MSMEDashboard } from "@/components/dashboards/msme-dashboard";
import { getCurrentSession, requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    view?: string;
    error?: string;
    message?: string;
    q?: string;
    projectId?: string;
    tab?: string;
    category?: string;
    status?: string;
  }>;
};

export default async function MSMEDashboardPage({ searchParams }: PageProps) {
  await requireRole(["MSME", "ADMIN"]);
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const params = await searchParams;
  return (
    <MSMEDashboard
      userId={session.userId}
      isAdmin={session.role === "ADMIN"}
      view={params.view}
      error={params.error}
      message={params.message}
      q={params.q}
      projectId={params.projectId}
      tab={params.tab}
      category={params.category}
      status={params.status}
    />
  );
}
