import Link from "next/link";
import { logout } from "@/app/actions/auth-actions";
import { prisma } from "@/lib/db";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { CreateStudyBuilder } from "@/components/studies/create-study-builder";
import { TimedToast } from "@/components/ui/timed-toast";
import { StudyDeleteControl } from "@/components/dashboards/study-delete-control";
import { ClipboardList, LayoutDashboard, PlusCircle, UserRound } from "lucide-react";

interface StudyParticipantSummary {
  id: string;
  status: string;
  panelist: { name: string };
}

interface StudySummary {
  id: string;
  title: string;
  productName: string;
  creatorId: string;
  location: string;
  category: string;
  stage: string;
  status: string;
  sampleSize: number;
  participants: StudyParticipantSummary[];
  _count: {
    responses: number;
    participants: number;
  };
}

export async function MsmeDashboard({
  userId,
  view,
  error,
  message,
  q,
}: {
  userId: string;
  view?: string;
  error?: string;
  message?: string;
  q?: string;
}) {
  const activeView = parseMsmeView(view);
  const normalizedQuery = (q ?? "").trim().toLowerCase();
  let historyStudies: StudySummary[] = [];
  let dbError: string | null = null;
  let totalStudies = 0;
  let ficBookings = 0;
  let totalResponses = 0;
  let activeStudies = 0;

  try {
    [totalStudies, ficBookings, totalResponses, activeStudies] = await Promise.all([
      prisma.study.count({
        where: { creatorId: userId },
      }),
      prisma.study.count({
        where: {
          creatorId: userId,
          OR: [
            {
              targetDemographics: {
                path: ["coordinationMode"],
                equals: "FIC_ASSISTED",
              },
            },
            {
              location: {
                contains: "fic",
                mode: "insensitive",
              },
            },
          ],
        },
      }),
      prisma.sensoryResponse.count({
        where: {
          study: {
            creatorId: userId,
          },
        },
      }),
      prisma.study.count({
        where: {
          creatorId: userId,
          status: { in: ["ACTIVE", "RECRUITING"] },
        },
      }),
    ]);

    if (activeView === "history") {
      historyStudies = (await prisma.study.findMany({
        where: { creatorId: userId },
        orderBy: { createdAt: "desc" },
        include: {
          participants: {
            orderBy: { selectionOrder: "asc" },
            select: { id: true, status: true, panelist: { select: { name: true } } },
          },
          _count: {
            select: {
              responses: true,
              participants: true,
            },
          },
        },
        take: 20,
      })) as unknown as StudySummary[];
    }
  } catch (error) {
    dbError = extractDatabaseError(error);
  }

  const filteredStudies = normalizedQuery
    ? historyStudies.filter((study) => {
        const searchable = [
          study.title,
          study.productName,
          study.location,
          study.category,
          study.stage,
          study.status,
          ...study.participants.map((participant) => participant.panelist.name),
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(normalizedQuery);
      })
    : historyStudies;

  return (
    <DashboardShell
      workspaceLabel="MSME Workspace"
      title="MSME Dashboard"
      subtitle="Create and manage studies, coordinate with FIC, and monitor response progress in one view."
      searchPlaceholder="Search your studies and response status"
      searchValue={q}
      statusLabel="Study operations"
      navItems={[
        { label: "Dashboard", href: "/msme/dashboard?view=dashboard", icon: LayoutDashboard, active: activeView === "dashboard" },
        { label: "Profile", href: "/msme/dashboard?view=profile", icon: UserRound, active: activeView === "profile" },
        { label: "Create Study", href: "/msme/dashboard?view=create-study", icon: PlusCircle, active: activeView === "create-study" },
        {
          label: "Study History",
          href: "/msme/dashboard?view=history",
          icon: ClipboardList,
          badge: `${totalStudies}`,
          active: activeView === "history",
        },
      ]}
      stats={[
        { label: "Book to FIC", value: `${ficBookings}`, helper: "Studies using FIC facilities", icon: ClipboardList, tone: "amber" },
        { label: "Recent / History", value: `${totalStudies}`, helper: "Total studies created", icon: LayoutDashboard, tone: "sky" },
        { label: "Survey Responses", value: `${totalResponses}`, helper: "Responses collected", icon: ClipboardList, tone: "mint" },
        { label: "Active Studies", value: `${activeStudies}`, helper: "Recruiting or ongoing studies", icon: PlusCircle, tone: "slate" },
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
          <NotificationPanel userId={userId} redirectTo="/msme/dashboard?view=dashboard" />
        </CollapsibleSection>
      )}

      {activeView === "profile" && (
        <ProfileWorkspace userId={userId} role="MSME" error={error} message={message} embedded />
      )}

      {activeView === "create-study" && (
        <CreateStudyBuilder embedded />
      )}

      {dbError && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-lg font-semibold text-red-800">Database connection error</h2>
          <p className="mt-2 text-red-700">{dbError}</p>
        </section>
      )}

      {activeView === "history" && !dbError && filteredStudies.length === 0 && (
        <section className="rounded-2xl border border-[#e4d7cc] bg-white p-8 text-center">
          <h2 className="text-xl font-semibold text-[#2e231c]">{historyStudies.length === 0 ? "No studies yet" : "No matching studies"}</h2>
          <p className="mt-2 text-[#6f5b4f]">
            {historyStudies.length === 0
              ? "Create your first study to start your MSME workflow."
              : "Try another search term to find your study."}
          </p>
        </section>
      )}

      {activeView === "history" && !dbError && filteredStudies.length > 0 && (
        <CollapsibleSection id="study-history" title="MSME Study List" countLabel={`${filteredStudies.length}`} defaultOpen={true}>
          <div className="space-y-4">
            {filteredStudies.map((study) => {
              const targetReached = study._count.responses >= study.sampleSize;
              const hasAnyParticipants = study._count.participants > 0;
              return (
                <article key={study.id} className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <h2 className="text-xl font-semibold text-[#2e231c]">{study.title}</h2>
                      <p className="text-[#6f5b4f]">{study.productName}</p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.category}</span>
                        <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.stage}</span>
                        <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.status}</span>
                        <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-[#1e4f8f]">
                          Responses {study._count.responses}/{study.sampleSize}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Link
                        href={`/studies/${study.id}/form`}
                        className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                      >
                        Form + QR
                      </Link>
                      <Link
                        href={`/dashboard/${study.id}`}
                        className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                      >
                        Open Dashboard
                      </Link>
                      {targetReached ? (
                        <span className="inline-flex items-center justify-center rounded-lg bg-[#e8f8ed] px-4 py-2 text-sm font-medium text-[#1d7c4a]">
                          All Participants Completed
                        </span>
                      ) : !hasAnyParticipants ? (
                        <span className="inline-flex items-center justify-center rounded-lg bg-[#fff7e9] px-4 py-2 text-sm font-medium text-[#8a5a00]">
                          No Participants Assigned Yet
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center rounded-lg bg-[#edf5ff] px-4 py-2 text-sm font-medium text-[#1e4f8f]">
                          Awaiting Consumer Responses
                        </span>
                      )}
                    </div>
                  </div>
                  <StudyDeleteControl studyId={study.id} redirectTo="/msme/dashboard?view=history" />
                </article>
              );
            })}
          </div>
        </CollapsibleSection>
      )}
    </DashboardShell>
  );
}

function parseMsmeView(value?: string) {
  if (value === "profile" || value === "create-study" || value === "history") {
    return value;
  }
  return "dashboard";
}

function extractDatabaseError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("Authentication failed")) {
      return "Authentication failed for the configured PostgreSQL user.";
    }
    return error.message;
  }
  return "Unknown database error.";
}
