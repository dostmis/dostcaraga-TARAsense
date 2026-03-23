import Link from "next/link";
import { logout, reviewRoleApplication } from "@/app/actions/auth-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { TimedToast } from "@/components/ui/timed-toast";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { Building2, CheckCircle2, FlaskConical, LayoutDashboard, ShieldCheck, UserRound, Users, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ error?: string; message?: string; view?: string; q?: string }>;
};

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  await requireRole(["ADMIN"]);
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const params = await searchParams;
  const { error, message, q } = params;
  const activeView = parseAdminView(params.view);

  const [studies, users, panelists, requests] = await Promise.all([
    prisma.study.count(),
    prisma.user.count(),
    prisma.panelist.count(),
    prisma.roleUpgradeRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { name: true, email: true, role: true, organization: true },
        },
      },
      take: 50,
    }),
  ]);
  const normalizedQuery = (q ?? "").trim().toLowerCase();
  const filteredRequests = normalizedQuery
    ? requests.filter((request) => {
        const entry = [
          request.user.name,
          request.user.email,
          request.user.role,
          request.targetRole,
          request.status,
          request.user.organization ?? "",
          request.reason ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return entry.includes(normalizedQuery);
      })
    : requests;

  const pendingRequests = filteredRequests.filter((request) => request.status === "PENDING").length;
  const approvedRequests = filteredRequests.filter((request) => request.status === "APPROVED").length;
  const rejectedRequests = filteredRequests.filter((request) => request.status === "REJECTED").length;

  return (
    <DashboardShell
      workspaceLabel="Administration"
      title="Admin Dashboard"
      subtitle="Full access to platform activity, role approvals, and cross-workspace monitoring."
      searchPlaceholder="Search users, requests, or studies"
      searchValue={q}
      statusLabel="Admin control center"
      navItems={[
        { label: "Dashboard", href: "/admin/dashboard?view=dashboard", icon: LayoutDashboard, active: activeView === "dashboard" },
        { label: "Profile", href: "/admin/dashboard?view=profile", icon: UserRound, active: activeView === "profile" },
        {
          label: "Role Requests",
          href: "/admin/dashboard?view=role-requests",
          icon: ShieldCheck,
          badge: `${pendingRequests}`,
          active: activeView === "role-requests",
        },
        { label: "MSME View", href: "/msme/dashboard", icon: Building2 },
        { label: "FIC View", href: "/fic/dashboard", icon: FlaskConical },
      ]}
      stats={[
        { label: "Total Studies", value: `${studies}`, helper: "All studies in the platform", icon: LayoutDashboard, tone: "sky" },
        { label: "Registered Users", value: `${users}`, helper: "All active user accounts", icon: Users, tone: "mint" },
        { label: "Pending Requests", value: `${pendingRequests}`, helper: "Awaiting review decisions", icon: ShieldCheck, tone: "amber" },
        { label: "Approved Requests", value: `${approvedRequests}`, helper: "Successfully upgraded access", icon: CheckCircle2, tone: "mint" },
        { label: "Rejected Requests", value: `${rejectedRequests}`, helper: "Declined role upgrades", icon: XCircle, tone: "rose" },
        { label: "Panelist Profiles", value: `${panelists}`, helper: "Profiles used for recruitment", icon: UserRound, tone: "slate" },
      ]}
      sidebarFooter={
        <form action={logout}>
          <button type="submit" className="app-button-secondary w-full py-2 text-sm">
            Logout
          </button>
        </form>
      }
    >
      <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
        <NotificationPanel userId={session.userId} redirectTo="/admin/dashboard" />
      </CollapsibleSection>

      <TimedToast
        title={error ? "System Error" : "System Message"}
        message={error ? decodeURIComponent(error) : message ? decodeURIComponent(message) : undefined}
        variant={error ? "error" : "success"}
        durationMs={3000}
      />

      {activeView === "profile" && (
        <ProfileWorkspace userId={session.userId} role={session.role} error={error} message={message} embedded />
      )}

      {activeView === "dashboard" && (
        <>
          <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
            <NotificationPanel userId={session.userId} redirectTo="/admin/dashboard?view=dashboard" />
          </CollapsibleSection>
          <section className="grid gap-4 md:grid-cols-2">
            <Link
              href="/msme/dashboard"
              className="rounded-2xl border border-[#e4d7cc] bg-white p-6 transition-colors hover:border-[#d7b8a1]"
            >
              <h2 className="text-xl font-semibold text-[#2e231c]">Open MSME Access</h2>
              <p className="mt-2 text-sm text-[#6f5b4f]">Study creation, booking status, and survey response progress.</p>
            </Link>
            <Link
              href="/fic/dashboard"
              className="rounded-2xl border border-[#e4d7cc] bg-white p-6 transition-colors hover:border-[#d7b8a1]"
            >
              <h2 className="text-xl font-semibold text-[#2e231c]">Open FIC Access</h2>
              <p className="mt-2 text-sm text-[#6f5b4f]">Facility queue, uploaded studies, and in-lab coordination updates.</p>
            </Link>
          </section>
        </>
      )}

      {activeView === "role-requests" && (
        <>
          <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
            <NotificationPanel userId={session.userId} redirectTo="/admin/dashboard?view=role-requests" />
          </CollapsibleSection>
          <section className="space-y-4 rounded-2xl border border-[#e4d7cc] bg-white p-6">
            <h2 className="text-xl font-semibold text-[#2e231c]">Role Upgrade Applications</h2>
            {filteredRequests.length === 0 && <p className="text-sm text-[#6f5b4f]">No applications found.</p>}

            {filteredRequests.map((request) => (
              <article key={request.id} className="space-y-3 rounded-xl border border-[#eadfd6] bg-[#fffdfb] p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-medium text-[#2e231c]">
                      {request.user.name} ({request.user.email})
                    </p>
                    <p className="text-sm text-[#6f5b4f]">
                      Current Role: {request.user.role} {"->"} Requested: {request.targetRole}
                    </p>
                    {request.user.organization && <p className="text-xs text-[#8c776a]">Organization: {request.user.organization}</p>}
                  </div>
                  <p className="text-xs text-[#8c776a]">
                    {new Date(request.createdAt).toLocaleString()} | {request.status}
                  </p>
                </div>

                {request.reason && (
                  <div className="rounded-lg border border-[#eadfd6] bg-[#faf6f2] p-3 text-sm text-[#5b4739]">{request.reason}</div>
                )}

                {request.status === "PENDING" && (
                  <div className="flex flex-wrap gap-2">
                    <form action={reviewRoleApplication}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="decision" value="APPROVE" />
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                      >
                        Approve
                      </button>
                    </form>
                    <form action={reviewRoleApplication}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="decision" value="REJECT" />
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </DashboardShell>
  );
}

function parseAdminView(value?: string) {
  if (value === "profile" || value === "role-requests") {
    return value;
  }
  return "dashboard";
}
