import Link from "next/link";
import { logout } from "@/app/actions/auth-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { ClipboardCheck, LayoutDashboard, MapPin, TestTube2, UserRound } from "lucide-react";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ view?: string; error?: string; message?: string; q?: string }>;
};

export default async function FicDashboardPage({ searchParams }: PageProps) {
  await requireRole(["FIC", "ADMIN"]);
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const params = await searchParams;
  const { error, message, q } = params;
  const activeView = parseFicView(params.view);

  const [studies] = await Promise.all([
    prisma.study.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        creator: { select: { name: true, organization: true } },
        _count: { select: { responses: true, participants: true } },
      },
      take: 20,
    }),
  ]);

  const normalizedQuery = (q ?? "").trim().toLowerCase();
  const filteredStudies = normalizedQuery
    ? studies.filter((study) => {
        const entry = [
          study.title,
          study.productName,
          study.location,
          study.status,
          study.creator.name ?? "",
          study.creator.organization ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return entry.includes(normalizedQuery);
      })
    : studies;

  const ficRelevant = filteredStudies.filter((study) => study.location.toLowerCase().includes("fic"));
  const activeStudies = filteredStudies.filter((study) => study.status === "ACTIVE" || study.status === "RECRUITING").length;
  const totalResponses = filteredStudies.reduce((sum, study) => sum + study._count.responses, 0);

  return (
    <DashboardShell
      workspaceLabel="FIC Workspace"
      title="FIC Dashboard"
      subtitle="Monitor facility-related studies, booking flow, and study analysis handoff."
      searchPlaceholder="Search studies, products, or MSME uploads"
      searchValue={q}
      statusLabel="Facility coordination"
      navItems={[
        { label: "Dashboard", href: "/fic/dashboard?view=dashboard", icon: LayoutDashboard, active: activeView === "dashboard" },
        { label: "Profile", href: "/fic/dashboard?view=profile", icon: UserRound, active: activeView === "profile" },
        {
          label: "Facility Queue",
          href: "/fic/dashboard?view=queue",
          icon: ClipboardCheck,
          badge: `${ficRelevant.length}`,
          active: activeView === "queue",
        },
      ]}
      stats={[
        { label: "Booking Notifications", value: `${ficRelevant.length}`, helper: "Studies tagged for FIC facilities", icon: MapPin, tone: "amber" },
        { label: "Uploaded Studies", value: `${studies.length}`, helper: "Visible MSME study submissions", icon: TestTube2, tone: "sky" },
        { label: "Active Studies", value: `${activeStudies}`, helper: "Recruiting or currently running", icon: LayoutDashboard, tone: "mint" },
        { label: "Total Responses", value: `${totalResponses}`, helper: "Responses across visible studies", icon: ClipboardCheck, tone: "slate" },
      ]}
      sidebarFooter={
        <form action={logout}>
          <button type="submit" className="app-button-secondary w-full py-2 text-sm">
            Logout
          </button>
        </form>
      }
    >
      {activeView === "dashboard" && (
        <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
          <NotificationPanel userId={session.userId} redirectTo="/fic/dashboard?view=dashboard" />
        </CollapsibleSection>
      )}

      {activeView === "profile" && (
        <ProfileWorkspace userId={session.userId} role={session.role} error={error} message={message} embedded />
      )}

      {activeView === "queue" && (
        <section className="space-y-4">
          {filteredStudies.length === 0 && (
            <article className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
              <h2 className="text-lg font-semibold text-[#2e231c]">No matching studies</h2>
              <p className="mt-1 text-sm text-[#6f5b4f]">Try a different search term.</p>
            </article>
          )}
          {filteredStudies.map((study) => (
            <article key={study.id} className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-[#2e231c]">{study.title}</h2>
                  <p className="mt-1 text-[#6f5b4f]">{study.productName}</p>
                  <p className="mt-2 text-xs text-[#8c776a]">
                    Uploaded by {study.creator.name}
                    {study.creator.organization ? ` (${study.creator.organization})` : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.location}</span>
                    <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.status}</span>
                    <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-[#1e4f8f]">Responses: {study._count.responses}</span>
                  </div>
                </div>
                <div className="flex gap-2 self-start">
                  <Link
                    href={`/studies/${study.id}/form`}
                    className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                  >
                    View Form
                  </Link>
                  <Link
                    href={`/dashboard/${study.id}`}
                    className="inline-flex items-center justify-center rounded-lg bg-[#ed7f2a] px-4 py-2 text-sm font-medium text-white hover:bg-[#dc6f1d]"
                  >
                    View Dashboard
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </DashboardShell>
  );
}

function parseFicView(value?: string) {
  if (value === "profile" || value === "queue") {
    return value;
  }
  return "dashboard";
}
