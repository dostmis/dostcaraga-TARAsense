import { PageShell } from "@/components/ui/page-shell";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { getCurrentSession, requireRole } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function ProfilePage({ searchParams }: PageProps) {
  await requireRole(["MSME", "FIC", "CONSUMER", "ADMIN"]);
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }

  const { error, message } = await searchParams;

  return (
    <PageShell maxWidthClassName="max-w-5xl">
      <ProfileWorkspace
        userId={session.userId}
        role={session.role}
        error={error}
        message={message}
        backHref={ROLE_DASHBOARD_PATH[session.role]}
      />
    </PageShell>
  );
}
