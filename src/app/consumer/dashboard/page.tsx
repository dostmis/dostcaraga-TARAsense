import Link from "next/link";
import { applyForRole, logout } from "@/app/actions/auth-actions";
import { chooseSessionOption, participateInStudy } from "@/app/actions/participant-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { TimedToast } from "@/components/ui/timed-toast";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { ClipboardList, Compass, FileText, LayoutDashboard, ShieldCheck, UserRound } from "lucide-react";
import { formatPanelistNumber, parseOfferedSessions } from "@/lib/participant-assignment";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ error?: string; message?: string; view?: string; q?: string }>;
};

export default async function ConsumerDashboardPage({ searchParams }: PageProps) {
  await requireRole(["CONSUMER"]);
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }
  const params = await searchParams;
  const { error, message, q } = params;
  const activeView = parseConsumerView(params.view);

  const [availableStudies, applications] = await Promise.all([
    prisma.study.findMany({
      where: {
        status: { in: ["RECRUITING", "ACTIVE"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        participants: {
          where: {
            panelist: {
              userId: session.userId,
            },
          },
          select: {
            id: true,
            status: true,
            panelistNumber: true,
            randomizeCode: true,
            offeredSessions: true,
            requestedSessionAt: true,
            sessionAt: true,
          },
          take: 1,
        },
        _count: {
          select: {
            sensoryAttributes: true,
          },
        },
      },
      take: 20,
    }),
    prisma.roleUpgradeRequest.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  const normalizedQuery = (q ?? "").trim().toLowerCase();
  const filteredStudies = normalizedQuery
    ? availableStudies.filter((study) => {
        const entry = [study.title, study.productName, study.category, study.stage, study.status].join(" ").toLowerCase();
        return entry.includes(normalizedQuery);
      })
    : availableStudies;
  const filteredApplications = normalizedQuery
    ? applications.filter((application) => {
        const entry = [application.targetRole, application.status, application.reason ?? ""].join(" ").toLowerCase();
        return entry.includes(normalizedQuery);
      })
    : applications;

  const pendingApplications = filteredApplications.filter((app) => app.status === "PENDING").length;
  const approvedApplications = filteredApplications.filter((app) => app.status === "APPROVED").length;
  const completedStudies = filteredStudies.filter((study) => study.participants[0]?.status === "COMPLETED");
  const openStudies = filteredStudies.filter((study) => study.participants[0]?.status !== "COMPLETED");

  return (
    <DashboardShell
      workspaceLabel="Consumer Workspace"
      title="Consumer Dashboard"
      subtitle="Track study invitations, apply for role upgrades, and manage your participation flow."
      searchPlaceholder="Search studies and applications"
      searchValue={q}
      statusLabel="Consumer panel"
      navItems={[
        { label: "Dashboard", href: "/consumer/dashboard?view=dashboard", icon: LayoutDashboard, active: activeView === "dashboard" },
        { label: "Profile", href: "/consumer/dashboard?view=profile", icon: UserRound, active: activeView === "profile" },
        {
          label: "Available Surveys",
          href: "/consumer/dashboard?view=available",
          icon: Compass,
          badge: `${openStudies.length}`,
          active: activeView === "available",
        },
        {
          label: "Completed Surveys",
          href: "/consumer/dashboard?view=completed",
          icon: ClipboardList,
          badge: `${completedStudies.length}`,
          active: activeView === "completed",
        },
        {
          label: "Role Applications",
          href: "/consumer/dashboard?view=applications",
          icon: ShieldCheck,
          badge: `${pendingApplications}`,
          active: activeView === "applications",
        },
      ]}
      stats={[
        { label: "Study Notifications", value: `${openStudies.length}`, helper: "Active studies you can join", icon: Compass, tone: "sky" },
        { label: "Pending Applications", value: `${pendingApplications}`, helper: "Awaiting admin review", icon: ShieldCheck, tone: "amber" },
        { label: "Approved Upgrades", value: `${approvedApplications}`, helper: "Role requests approved", icon: ClipboardList, tone: "mint" },
        { label: "Completed Surveys", value: `${completedStudies.length}`, helper: "Surveys you already submitted", icon: FileText, tone: "slate" },
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

      {activeView === "dashboard" && (
        <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
          <NotificationPanel userId={session.userId} redirectTo="/consumer/dashboard?view=dashboard" />
        </CollapsibleSection>
      )}

      {activeView === "profile" && (
        <ProfileWorkspace userId={session.userId} role={session.role} error={error} message={message} embedded />
      )}

      {activeView === "applications" && (
        <>
          <section className="space-y-4 rounded-2xl border border-[#e4d7cc] bg-white p-6">
            <h2 className="text-xl font-semibold text-[#2e231c]">Apply for Access Upgrade</h2>
            <p className="text-sm text-[#6f5b4f]">All accounts start as Consumer. Submit an application and wait for admin approval.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <form action={applyForRole} className="space-y-3 rounded-xl border border-[#eadfd6] bg-[#fffdfb] p-4">
                <h3 className="font-medium text-[#2e231c]">Apply for MSME User</h3>
                <input type="hidden" name="targetRole" value="MSME" />
                <textarea
                  name="reason"
                  placeholder="Reason for MSME access (optional)"
                  className="min-h-20 w-full rounded-lg border border-[#daccc0] bg-white px-3 py-2 text-sm text-[#3f2f25] outline-none placeholder:text-[#9b8471]"
                />
                <button type="submit" className="w-full rounded-lg bg-[#ed7f2a] py-2 text-sm font-semibold text-white hover:bg-[#dc6f1d]">
                  Submit MSME Application
                </button>
              </form>

              <form action={applyForRole} className="space-y-3 rounded-xl border border-[#eadfd6] bg-[#fffdfb] p-4">
                <h3 className="font-medium text-[#2e231c]">Apply for FIC User</h3>
                <input type="hidden" name="targetRole" value="FIC" />
                <textarea
                  name="reason"
                  placeholder="Reason for FIC access (optional)"
                  className="min-h-20 w-full rounded-lg border border-[#daccc0] bg-white px-3 py-2 text-sm text-[#3f2f25] outline-none placeholder:text-[#9b8471]"
                />
                <button type="submit" className="w-full rounded-lg bg-[#ed7f2a] py-2 text-sm font-semibold text-white hover:bg-[#dc6f1d]">
                  Submit FIC Application
                </button>
              </form>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-[#e4d7cc] bg-white p-6">
            <h2 className="text-xl font-semibold text-[#2e231c]">Application History</h2>
            {filteredApplications.length === 0 && <p className="text-sm text-[#6f5b4f]">No role applications found.</p>}
            {filteredApplications.map((application) => (
              <div key={application.id} className="rounded-lg border border-[#eadfd6] bg-[#fffdfb] p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-[#2e231c]">
                    {application.targetRole} access - <span className="text-[#6f5b4f]">{application.status}</span>
                  </p>
                  <p className="text-xs text-[#8c776a]">{new Date(application.createdAt).toLocaleString()}</p>
                </div>
                {application.reason && <p className="mt-2 text-[#6f5b4f]">{application.reason}</p>}
              </div>
            ))}
          </section>
        </>
      )}

      {activeView === "available" && (
        <CollapsibleSection id="available-studies" title="Available Surveys" countLabel={`${openStudies.length}`} defaultOpen={true}>
          <div className="space-y-4">
            {openStudies.length === 0 && (
              <article className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                <h2 className="text-lg font-semibold text-[#2e231c]">No active studies at the moment.</h2>
                <p className="mt-1 text-sm text-[#6f5b4f]">Check back later for new survey opportunities.</p>
              </article>
            )}

            {openStudies.map((study) => {
              const myParticipation = study.participants[0];
              const offeredSessions = myParticipation ? parseOfferedSessions(myParticipation.offeredSessions) : [];
              return (
                <article key={study.id} className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-[#2e231c]">{study.title}</h2>
                      <p className="mt-1 text-[#6f5b4f]">{study.productName}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.category}</span>
                        <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.stage}</span>
                        <span className="rounded-full bg-[#e8f8ed] px-2.5 py-1 text-[#1d7c4a]">{study.status}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/studies/${study.id}/form`}
                        className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                      >
                        View Study
                      </Link>
                      {!myParticipation && (
                        <form action={participateInStudy}>
                          <input type="hidden" name="studyId" value={study.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-lg bg-[#ed7f2a] px-4 py-2 text-sm font-medium text-white hover:bg-[#dc6f1d]"
                          >
                            Participate
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                  {myParticipation && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-[#6f5b4f]">
                        Assigned Panelist No: {formatPanelistNumber(myParticipation.panelistNumber)}
                      </p>
                      <p className="text-xs text-[#6f5b4f]">
                        Session Schedule: {myParticipation.sessionAt ? new Date(myParticipation.sessionAt).toLocaleString() : "Not confirmed"}
                      </p>
                      {myParticipation.status === "WAITLIST" && (
                        <p className="text-xs font-medium text-[#8a5a00]">
                          Participation submitted. Waiting for MSME qualification.
                        </p>
                      )}
                      {offeredSessions.length > 0 && !myParticipation.requestedSessionAt && (
                        <form action={chooseSessionOption} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="studyId" value={study.id} />
                          <input type="hidden" name="participantId" value={myParticipation.id} />
                          <label className="text-xs text-[#6f5b4f]">
                            Choose offered session
                            <select
                              name="sessionChoice"
                              className="ml-2 rounded-md border border-[#d8c7b8] px-2 py-1 text-xs"
                              required
                            >
                              <option value="">Select</option>
                              {offeredSessions.map((option) => (
                                <option key={option} value={option}>
                                  {new Date(option).toLocaleString()}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="submit"
                            className="rounded-md border border-[#ed7f2a] bg-[#ed7f2a] px-3 py-1 text-xs font-semibold text-white hover:bg-[#dc6f1d]"
                          >
                            Submit Session Choice
                          </button>
                        </form>
                      )}
                      {myParticipation.requestedSessionAt && !myParticipation.sessionAt && (
                        <p className="text-xs font-medium text-[#1e4f8f]">
                          Selected session: {new Date(myParticipation.requestedSessionAt).toLocaleString()} (awaiting MSME confirmation)
                        </p>
                      )}
                      {myParticipation.sessionAt && (
                        <p className="text-xs font-medium text-[#1d7c4a]">
                          Session confirmed. Open &quot;View Study&quot; and tap START on testing day.
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {activeView === "completed" && (
        <CollapsibleSection id="completed-surveys" title="Completed Surveys" countLabel={`${completedStudies.length}`} defaultOpen={true}>
          <div className="space-y-4">
            {completedStudies.length === 0 && (
              <article className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                <h2 className="text-lg font-semibold text-[#2e231c]">No completed surveys yet.</h2>
                <p className="mt-1 text-sm text-[#6f5b4f]">Completed studies will appear here after submission.</p>
              </article>
            )}

            {completedStudies.map((study) => (
              <article key={study.id} className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-[#2e231c]">{study.title}</h2>
                    <p className="mt-1 text-[#6f5b4f]">{study.productName}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.category}</span>
                      <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.stage}</span>
                      <span className="rounded-full bg-[#e8f8ed] px-2.5 py-1 text-[#1d7c4a]">Completed</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/studies/${study.id}/form`}
                      className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                    >
                      View Study
                    </Link>
                    <span className="inline-flex items-center justify-center rounded-lg bg-[#e8f8ed] px-4 py-2 text-sm font-medium text-[#1d7c4a]">
                      Submitted
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </DashboardShell>
  );
}

function parseConsumerView(value?: string) {
  if (value === "profile" || value === "available" || value === "completed" || value === "applications") {
    return value;
  }
  return "dashboard";
}
