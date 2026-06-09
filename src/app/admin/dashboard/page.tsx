import Link from "next/link";
import { logout, reassignFicFacility, reviewRoleApplication } from "@/app/actions/auth-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { TimedToast } from "@/components/ui/timed-toast";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { Activity, Building2, CheckCircle2, FlaskConical, LayoutDashboard, ShieldCheck, UserRound, Users, XCircle } from "lucide-react";
import { FACILITY_REGION_ROWS, REGIONS } from "@/lib/facility-constants";
import { humanizeFicFacilityType, humanizeSensoryCapability } from "@/lib/fic-facility";
import { getLocationPath } from "@/lib/locations/psgc-queries";
import type { Prisma, UserRole } from "@prisma/client";

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
  const shouldLoadUsers = activeView === "users";
  const shouldLoadRequests = activeView === "role-requests";
  const shouldLoadFicAssignments = activeView === "role-requests";
  const shouldLoadUsage = activeView === "user-usage";
  const searchableUserRoles = ["ADMIN", "MSME", "FIC", "CONSUMER", "RESEARCHER", "FIC_MANAGER"] satisfies UserRole[];
  const matchingUserRoles = normalizedQuery
    ? searchableUserRoles.filter((role) => role.toLowerCase().includes(normalizedQuery))
    : [];
  const userWhere: Prisma.UserWhereInput | undefined =
    shouldLoadUsers && normalizedQuery
      ? {
          OR: [
            { name: { contains: normalizedQuery, mode: "insensitive" } },
            { email: { contains: normalizedQuery, mode: "insensitive" } },
            ...(matchingUserRoles.length > 0 ? [{ role: { in: matchingUserRoles } }] : []),
          ],
        }
      : undefined;
  const usageWhere: Prisma.UserUsageLogWhereInput | undefined =
    shouldLoadUsage && normalizedQuery
      ? {
          OR: [
            { actorName: { contains: normalizedQuery, mode: "insensitive" } },
            { actorEmail: { contains: normalizedQuery, mode: "insensitive" } },
            { action: { contains: normalizedQuery, mode: "insensitive" } },
            { summary: { contains: normalizedQuery, mode: "insensitive" } },
            { entityType: { contains: normalizedQuery, mode: "insensitive" } },
            { entityId: { contains: normalizedQuery, mode: "insensitive" } },
            ...(matchingUserRoles.length > 0 ? [{ actorRole: { in: matchingUserRoles } }] : []),
          ],
        }
      : undefined;

  const [studies, userCount, panelists, pendingRequests, approvedRequests, rejectedRequests, requests, ficUsers, userRows, usageRows, usageTotal] = await Promise.all([
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
              select: {
                name: true,
                email: true,
                role: true,
                organization: true,
                ficFacilityProfile: {
                  select: {
                    id: true,
                    facilityName: true,
                    institutionName: true,
                    regionId: true,
                    provinceId: true,
                    cityId: true,
                    physicalAddress: true,
                    website: true,
                    directorName: true,
                    position: true,
                    officialEmail: true,
                    contactNumber: true,
                    facilityType: true,
                    facilityTypeOther: true,
                    sensoryCapabilities: true,
                    govIdPath: true,
                    status: true,
                  },
                },
              },
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
    shouldLoadUsers
      ? prisma.user.findMany({
          where: userWhere,
          select: {
            name: true,
            email: true,
            role: true,
          },
          orderBy: [{ name: "asc" }, { email: "asc" }],
        })
      : Promise.resolve([]),
    shouldLoadUsage
      ? prisma.userUsageLog.findMany({
          where: usageWhere,
          select: {
            id: true,
            actorName: true,
            actorEmail: true,
            actorRole: true,
            action: true,
            entityType: true,
            entityId: true,
            summary: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
    shouldLoadUsage ? prisma.userUsageLog.count({ where: usageWhere }) : Promise.resolve(0),
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

  // Resolve PSGC names for each FIC facility dossier shown in the review list.
  const ficLocationLabelEntries = await Promise.all(
    filteredRequests
      .map((request) => request.user.ficFacilityProfile)
      .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
      .map(async (profile) => {
        const path = await getLocationPath({
          regionId: profile.regionId,
          provinceId: profile.provinceId,
          cityId: profile.cityId,
        });
        return [
          profile.id,
          {
            region: path.region?.shortName
              ? `${path.region.shortName} — ${path.region.name}`
              : path.region?.name ?? profile.regionId,
            province: path.province?.name ?? profile.provinceId,
            city: path.city ? (path.city.isCity ? `${path.city.name} (City)` : path.city.name) : profile.cityId,
          },
        ] as const;
      })
  );
  const ficLocationLabels = new Map(ficLocationLabelEntries);

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
        { label: "Users", href: "/admin/dashboard?view=users", icon: Users, active: activeView === "users" },
        { label: "User Usage", href: "/admin/dashboard?view=user-usage", icon: Activity, active: activeView === "user-usage" },
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
      stats={activeView === "dashboard" ? [
        { label: "Total Studies", value: `${studies}`, helper: "All studies in the platform", icon: LayoutDashboard, tone: "sky" },
        { label: "Registered Users", value: `${userCount}`, helper: "All active user accounts", icon: Users, tone: "mint" },
        { label: "Pending Requests", value: `${pendingRequests}`, helper: "Awaiting review decisions", icon: ShieldCheck, tone: "amber" },
        { label: "Approved Requests", value: `${approvedRequests}`, helper: "Successfully upgraded access", icon: CheckCircle2, tone: "mint" },
        { label: "Rejected Requests", value: `${rejectedRequests}`, helper: "Declined role upgrades", icon: XCircle, tone: "rose" },
        { label: "Panelist Profiles", value: `${panelists}`, helper: "Profiles used for recruitment", icon: UserRound, tone: "slate" },
      ] : undefined}
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
              href="/admin/dashboard?view=users"
              className="rounded-2xl border border-[#e4d7cc] bg-white p-6 transition-colors hover:border-[#d7b8a1]"
            >
              <h2 className="text-xl font-semibold text-[#2e231c]">View Users</h2>
              <p className="mt-2 text-sm text-[#6f5b4f]">Registered user names, emails, and assigned roles.</p>
            </Link>
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

      {activeView === "users" && (
        <>
          <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
            <NotificationPanel userId={session.userId} redirectTo="/admin/dashboard?view=users" />
          </CollapsibleSection>
          <section className="space-y-4 rounded-2xl border border-[#e4d7cc] bg-white p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#2e231c]">Users</h2>
                <p className="text-sm text-[#6f5b4f]">Admin-only list of registered accounts and platform roles.</p>
              </div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#8c776a]">{userRows.length} shown</p>
            </div>

            {userRows.length === 0 && <p className="text-sm text-[#6f5b4f]">No users found.</p>}

            {userRows.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-[#eadfd6] bg-[#fffdfb]">
                <table className="min-w-full divide-y divide-[#eadfd6] text-sm">
                  <thead className="bg-[#faf6f2] text-left text-[#6f5b4f]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1e5db] text-[#2e231c]">
                    {userRows.map((user) => (
                      <tr key={user.email}>
                        <td className="px-4 py-2 font-medium">{user.name}</td>
                        <td className="px-4 py-2 text-[#5b4739]">{user.email}</td>
                        <td className="px-4 py-2">{user.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeView === "user-usage" && (
        <>
          <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
            <NotificationPanel userId={session.userId} redirectTo="/admin/dashboard?view=user-usage" />
          </CollapsibleSection>
          <section className="space-y-4 rounded-2xl border border-[#e4d7cc] bg-white p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#2e231c]">User Usage</h2>
                <p className="text-sm text-[#6f5b4f]">Admin-only activity log of account, role, study, participation, and response actions.</p>
              </div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#8c776a]">
                {usageRows.length} shown{usageTotal > usageRows.length ? ` of ${usageTotal}` : ""}
              </p>
            </div>

            {usageRows.length === 0 && <p className="text-sm text-[#6f5b4f]">No usage activity found.</p>}

            {usageRows.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-[#eadfd6] bg-[#fffdfb]">
                <table className="min-w-full divide-y divide-[#eadfd6] text-sm">
                  <thead className="bg-[#faf6f2] text-left text-[#6f5b4f]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Timestamp</th>
                      <th className="px-4 py-2 font-medium">User</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium">Action</th>
                      <th className="px-4 py-2 font-medium">Details</th>
                      <th className="px-4 py-2 font-medium">Entity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1e5db] text-[#2e231c]">
                    {usageRows.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-[#6f5b4f]">{new Date(row.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-2">
                          <p className="font-medium">{row.actorName ?? "Unknown user"}</p>
                          {row.actorEmail && <p className="text-xs text-[#8c776a]">{row.actorEmail}</p>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">{row.actorRole ?? "-"}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-medium">{formatUsageAction(row.action)}</td>
                        <td className="min-w-[260px] px-4 py-2 text-[#5b4739]">{row.summary}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-[#8c776a]">
                          {row.entityType ? `${row.entityType}${row.entityId ? `: ${row.entityId}` : ""}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

                {request.targetRole === "FIC" && request.user.ficFacilityProfile && (
                  <div className="space-y-3 rounded-lg border border-[#eadfd6] bg-[#faf6f2] p-4 text-sm text-[#5b4739]">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#8c776a]">Facility Application Dossier</p>
                    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      <DossierItem label="Facility Name" value={request.user.ficFacilityProfile.facilityName} />
                      <DossierItem label="Institution / Company" value={request.user.ficFacilityProfile.institutionName} />
                      <DossierItem label="Region" value={ficLocationLabels.get(request.user.ficFacilityProfile.id)?.region} />
                      <DossierItem label="Province" value={ficLocationLabels.get(request.user.ficFacilityProfile.id)?.province} />
                      <DossierItem label="City / Municipality" value={ficLocationLabels.get(request.user.ficFacilityProfile.id)?.city} />
                      <DossierItem label="Physical Address" value={request.user.ficFacilityProfile.physicalAddress} />
                      <DossierItem
                        label="Website"
                        value={request.user.ficFacilityProfile.website ?? "—"}
                      />
                      <DossierItem label="Director / Head" value={request.user.ficFacilityProfile.directorName} />
                      <DossierItem label="Position" value={request.user.ficFacilityProfile.position} />
                      <DossierItem label="Official Email" value={request.user.ficFacilityProfile.officialEmail} />
                      <DossierItem label="Contact Number" value={request.user.ficFacilityProfile.contactNumber} />
                      <DossierItem
                        label="Facility Type"
                        value={
                          request.user.ficFacilityProfile.facilityType === "OTHER" && request.user.ficFacilityProfile.facilityTypeOther
                            ? `${humanizeFicFacilityType(request.user.ficFacilityProfile.facilityType)} — ${request.user.ficFacilityProfile.facilityTypeOther}`
                            : humanizeFicFacilityType(request.user.ficFacilityProfile.facilityType)
                        }
                      />
                    </dl>
                    <div>
                      <p className="text-xs font-medium text-[#8c776a]">Sensory Testing Capability</p>
                      {request.user.ficFacilityProfile.sensoryCapabilities.length > 0 ? (
                        <ul className="mt-1 flex flex-wrap gap-2">
                          {request.user.ficFacilityProfile.sensoryCapabilities.map((capability) => (
                            <li
                              key={`${request.id}-cap-${capability}`}
                              className="rounded-full bg-[#f3e7da] px-2.5 py-1 text-xs text-[#5a4536]"
                            >
                              {humanizeSensoryCapability(capability)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-[#8c776a]">None specified.</p>
                      )}
                    </div>
                    <div>
                      {request.user.ficFacilityProfile.govIdPath ? (
                        <a
                          href={`/api/uploads/fic-id/${request.user.ficFacilityProfile.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#c2410c] underline"
                        >
                          View uploaded government ID
                        </a>
                      ) : (
                        <p className="text-xs text-[#8c776a]">No government ID on file.</p>
                      )}
                    </div>
                  </div>
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
  if (value === "profile" || value === "role-requests" || value === "users" || value === "user-usage") {
    return value;
  }
  return "dashboard";
}

function formatUsageAction(action: string) {
  return action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DossierItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[#8c776a]">{label}</dt>
      <dd className="break-words text-[#2e231c]">{value && value.length > 0 ? value : "—"}</dd>
    </div>
  );
}
