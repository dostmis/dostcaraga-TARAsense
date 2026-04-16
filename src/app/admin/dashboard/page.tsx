import Link from "next/link";
import { logout, reassignFicFacility, reviewRoleApplication } from "@/app/actions/auth-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { TimedToast } from "@/components/ui/timed-toast";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { Building2, CheckCircle2, FlaskConical, LayoutDashboard, ShieldCheck, UserRound, Users, XCircle } from "lucide-react";
import { FACILITY_REGION_ROWS, REGIONS } from "@/lib/facility-constants";

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
  const normalizedQuery = (q ?? "").trim().toLowerCase();
  const shouldLoadRequests = activeView === "role-requests";
  const shouldLoadFicAssignments = activeView === "role-requests";

  const [studies, users, panelists, pendingRequests, approvedRequests, rejectedRequests, requests, ficUsers] = await Promise.all([
    prisma.study.count(),
    prisma.user.count(),
    prisma.panelist.count(),
    prisma.roleUpgradeRequest.count({ where: { status: "PENDING" } }),
    prisma.roleUpgradeRequest.count({ where: { status: "APPROVED" } }),
    prisma.roleUpgradeRequest.count({ where: { status: "REJECTED" } }),
    shouldLoadRequests
      ? prisma.roleUpgradeRequest.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: { name: true, email: true, role: true, organization: true },
            },
          },
          take: 50,
        })
      : Promise.resolve([]),
    shouldLoadFicAssignments
      ? prisma.user.findMany({
          where: {
            role: { in: ["FIC", "FIC_MANAGER"] },
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            assignedRegion: true,
            assignedFacility: true,
            assignmentUpdatedAt: true,
          },
          orderBy: [{ name: "asc" }],
          take: 200,
        })
      : Promise.resolve([]),
  ]);

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
                      <input type="hidden" name="redirectTo" value="/admin/dashboard?view=role-requests" />
                      {request.targetRole === "FIC" && (
                        <>
                          <select name="assignedRegion" className="app-select min-w-[180px]" required defaultValue="">
                            <option value="" disabled>
                              Select Region
                            </option>
                            {REGIONS.map((region) => (
                              <option key={`approve-region-${request.id}-${region}`} value={region}>
                                {region}
                              </option>
                            ))}
                          </select>
                          <select name="assignedFacility" className="app-select min-w-[220px]" required defaultValue="">
                            <option value="" disabled>
                              Select Facility
                            </option>
                            {FACILITY_REGION_ROWS.map((row) => (
                              <option key={`approve-facility-${request.id}-${row.facility}`} value={row.facility}>
                                {row.facility} ({row.region})
                              </option>
                            ))}
                          </select>
                        </>
                      )}
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
                      <input type="hidden" name="redirectTo" value="/admin/dashboard?view=role-requests" />
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

          <section className="space-y-4 rounded-2xl border border-[#e4d7cc] bg-white p-6">
            <h2 className="text-xl font-semibold text-[#2e231c]">FIC Region and Facility Assignment</h2>
            {ficUsers.length === 0 && <p className="text-sm text-[#6f5b4f]">No FIC users found.</p>}

            {ficUsers.length > 0 && (
              <>
                <form action={reassignFicFacility} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#eadfd6] bg-[#fffdfb] p-4">
                  <input type="hidden" name="redirectTo" value="/admin/dashboard?view=role-requests" />
                  <select name="ficUserId" className="app-select min-w-[280px]" required defaultValue="">
                    <option value="" disabled>
                      Select FIC User
                    </option>
                    {ficUsers.map((ficUser) => (
                      <option key={`reassign-fic-user-${ficUser.id}`} value={ficUser.id}>
                        {ficUser.name} ({ficUser.email})
                      </option>
                    ))}
                  </select>
                  <select name="assignedRegion" className="app-select min-w-[180px]" required defaultValue="">
                    <option value="" disabled>
                      Select Region
                    </option>
                    {REGIONS.map((region) => (
                      <option key={`reassign-region-${region}`} value={region}>
                        {region}
                      </option>
                    ))}
                  </select>
                  <select name="assignedFacility" className="app-select min-w-[240px]" required defaultValue="">
                    <option value="" disabled>
                      Select Facility
                    </option>
                    {FACILITY_REGION_ROWS.map((row) => (
                      <option key={`reassign-facility-${row.facility}`} value={row.facility}>
                        {row.facility} ({row.region})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-lg bg-[#2e231c] px-4 py-2 text-sm font-medium text-white hover:bg-[#20170f]"
                  >
                    Save Assignment
                  </button>
                </form>

                <div className="overflow-x-auto rounded-xl border border-[#eadfd6] bg-[#fffdfb]">
                  <table className="min-w-full divide-y divide-[#eadfd6] text-sm">
                    <thead className="bg-[#faf6f2] text-left text-[#6f5b4f]">
                      <tr>
                        <th className="px-4 py-2 font-medium">FIC User</th>
                        <th className="px-4 py-2 font-medium">Role</th>
                        <th className="px-4 py-2 font-medium">Current Assignment</th>
                        <th className="px-4 py-2 font-medium">Last Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f1e5db] text-[#2e231c]">
                      {ficUsers.map((ficUser) => (
                        <tr key={`assignment-row-${ficUser.id}`}>
                          <td className="px-4 py-2">
                            <p className="font-medium">{ficUser.name}</p>
                            <p className="text-xs text-[#8c776a]">{ficUser.email}</p>
                          </td>
                          <td className="px-4 py-2">{ficUser.role}</td>
                          <td className="px-4 py-2">
                            {ficUser.assignedFacility ?? "Unassigned"}
                            {ficUser.assignedRegion ? `, ${ficUser.assignedRegion}` : ""}
                          </td>
                          <td className="px-4 py-2 text-xs text-[#8c776a]">
                            {ficUser.assignmentUpdatedAt ? new Date(ficUser.assignmentUpdatedAt).toLocaleString() : "Not set yet"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
