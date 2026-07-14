import Link from "next/link";
import { logout } from "@/app/actions/auth-actions";
import { prisma } from "@/lib/db";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { CreateStudyBuilder } from "@/components/studies/create-study-builder";
import { CreateStudyImportPanel } from "@/components/studies/create-study-import-panel";
import { TimedToast } from "@/components/ui/timed-toast";
import { StudyPipelineList } from "@/components/studies/study-pipeline-list";
import { ProjectsListView } from "@/components/projects/projects-list-view";
import { ProjectDetailWorkspace } from "@/components/projects/project-detail-workspace";
import { doesPanelistMatchTargetConsumer } from "@/lib/target-consumer";
import { buildScheduleOpenWhere } from "@/lib/locations/study-visibility";
import { ClipboardList, Compass, FileUp, FolderKanban, LayoutDashboard, PlusCircle, UserRound } from "lucide-react";

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
  scheduleEndsAt: Date | null;
  participants: StudyParticipantSummary[];
  _count: {
    responses: number;
    participants: number;
  };
}

interface PeerStudySummary extends StudySummary {
  description: string | null;
  targetDemographics: unknown;
  creator: {
    name: string;
    organization: string | null;
  };
  _count: {
    responses: number;
    participants: number;
    sensoryAttributes: number;
  };
}

export async function MSMEDashboard({
  userId,
  isAdmin = false,
  view,
  error,
  message,
  q,
  projectId,
  tab,
  category,
  status,
}: {
  userId: string;
  isAdmin?: boolean;
  view?: string;
  error?: string;
  message?: string;
  q?: string;
  projectId?: string;
  tab?: string;
  category?: string;
  status?: string;
}) {
  const activeView = parseMSMEView(view);
  const normalizedQuery = (q ?? "").trim().toLowerCase();
  let historyStudies: StudySummary[] = [];
  let peerStudies: PeerStudySummary[] = [];
  let dbError: string | null = null;
  let totalStudies = 0;
  let ficBookings = 0;
  let totalResponses = 0;
  let activeStudies = 0;
  let peerStudyCount = 0;

  try {
    const [evaluatorPanelist, peerStudyRowsForCount] = await Promise.all([
      prisma.panelist.findFirst({
        where: { userId },
        select: {
          age: true,
          gender: true,
          lifestyle: true,
          dietaryPrefs: true,
          consumptionHabits: true,
          isActive: true,
        },
      }),
      prisma.study.findMany({
        where: {
          creatorId: { not: userId },
          creator: { role: "MSME" },
          status: { in: ["RECRUITING", "ACTIVE"] },
          AND: [buildScheduleOpenWhere()],
        },
        select: {
          targetDemographics: true,
          participants: {
            where: { panelist: { userId } },
            select: { status: true },
          },
        },
      }),
    ]);

    peerStudyCount = peerStudyRowsForCount.filter((study) => {
      if (!doesPanelistMatchTargetConsumer(evaluatorPanelist, study.targetDemographics)) {
        return false;
      }
      return study.participants.every((participant) => participant.status !== "COMPLETED");
    }).length;

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

    if (activeView === "evaluate") {
      const rawPeerStudies = (await prisma.study.findMany({
        where: {
          creatorId: { not: userId },
          creator: { role: "MSME" },
          status: { in: ["RECRUITING", "ACTIVE"] },
          AND: [buildScheduleOpenWhere()],
        },
        orderBy: { createdAt: "desc" },
        include: {
          creator: {
            select: {
              name: true,
              organization: true,
            },
          },
          participants: {
            where: { panelist: { userId } },
            select: { id: true, status: true, panelist: { select: { name: true } } },
          },
          _count: {
            select: {
              responses: true,
              participants: true,
              sensoryAttributes: true,
            },
          },
        },
        take: 20,
      })) as unknown as PeerStudySummary[];

      peerStudies = rawPeerStudies.filter((study) => {
        if (!doesPanelistMatchTargetConsumer(evaluatorPanelist, study.targetDemographics)) {
          return false;
        }
        return study.participants.every((participant) => participant.status !== "COMPLETED");
      });
    }

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
  const filteredPeerStudies = normalizedQuery
    ? peerStudies.filter((study) => {
        const searchable = [
          study.title,
          study.productName,
          study.location,
          study.category,
          study.stage,
          study.status,
          study.creator.name,
          study.creator.organization ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(normalizedQuery);
      })
    : peerStudies;

  return (
    <DashboardShell
      workspaceLabel="Innovator Workspace"
      title="Innovator Dashboard"
      subtitle="Create and manage studies, coordinate with FIC, and monitor response progress in one view."
      searchPlaceholder="Search your studies and response status"
      searchValue={q}
      statusLabel="Study operations"
      navItems={[
        { label: "Dashboard", href: "/msme/dashboard?view=dashboard", icon: LayoutDashboard, active: activeView === "dashboard" },
        { label: "Profile", href: "/msme/dashboard?view=profile", icon: UserRound, active: activeView === "profile" },
        {
          label: "Projects",
          href: "/msme/dashboard?view=projects",
          icon: FolderKanban,
          active: activeView === "projects",
        },
        { label: "Create Study", href: "/msme/dashboard?view=create-study", icon: PlusCircle, active: activeView === "create-study" },
        {
          label: "Import Existing Sensory Dataset",
          href: "/msme/dashboard?view=import-dataset",
          icon: FileUp,
          active: activeView === "import-dataset",
        },
        {
          label: "Evaluate Studies",
          href: "/msme/dashboard?view=evaluate",
          icon: Compass,
          badge: `${peerStudyCount}`,
          active: activeView === "evaluate",
        },
        {
          label: "Study Pipeline",
          href: "/msme/dashboard?view=history",
          icon: ClipboardList,
          badge: `${totalStudies}`,
          active: activeView === "history",
        },
      ]}
      stats={activeView === "dashboard" ? [
        { label: "FIC collaborations", value: `${ficBookings}`, helper: "Studies using FIC facilities", icon: ClipboardList, tone: "amber" },
        { label: "Studies completed", value: `${totalStudies}`, helper: "Total studies created", icon: LayoutDashboard, tone: "sky" },
        { label: "Responses collected", value: `${totalResponses}`, helper: "Responses collected", icon: ClipboardList, tone: "mint" },
        { label: "Active Studies", value: `${activeStudies}`, helper: "Recruiting or ongoing studies", icon: PlusCircle, tone: "slate" },
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

      {activeView === "dashboard" && (
        <CollapsibleSection title="System Messages" id="system-messages" defaultOpen={false}>
          <NotificationPanel userId={userId} redirectTo="/msme/dashboard?view=dashboard" />
        </CollapsibleSection>
      )}

      {activeView === "profile" && (
        <ProfileWorkspace userId={userId} role="MSME" error={error} message={message} embedded />
      )}

      {activeView === "create-study" && (
        <CreateStudyBuilder embedded projectId={projectId} />
      )}

      {activeView === "import-dataset" && (
        <CreateStudyImportPanel />
      )}

      {activeView === "projects" &&
        (projectId ? (
          <ProjectDetailWorkspace projectId={projectId} userId={userId} isAdmin={isAdmin} tab={tab} />
        ) : (
          <ProjectsListView userId={userId} q={q} category={category} status={status} />
        ))}

      {activeView === "evaluate" && !dbError && filteredPeerStudies.length === 0 && (
        <section className="rounded-2xl border border-[#e4d7cc] bg-white p-8 text-center">
          <h2 className="text-xl font-semibold text-[#2e231c]">{peerStudies.length === 0 ? "No eligible peer studies" : "No matching studies"}</h2>
          <p className="mt-2 text-[#6f5b4f]">
            {peerStudies.length === 0
              ? "Only open studies created by other MSME users and matching your panelist profile appear here."
              : "Try another search term to find an evaluation."}
          </p>
        </section>
      )}

      {activeView === "evaluate" && !dbError && filteredPeerStudies.length > 0 && (
        <CollapsibleSection id="peer-evaluation-studies" title="Available Peer Evaluations" countLabel={`${filteredPeerStudies.length}`} defaultOpen={true}>
          <div className="space-y-4">
            {filteredPeerStudies.map((study) => {
              const myParticipation = study.participants[0] ?? null;
              return (
                <article key={study.id} className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <h2 className="text-xl font-semibold text-[#2e231c]">{study.title}</h2>
                      <p className="text-[#6f5b4f]">{study.productName}</p>
                      <p className="text-sm text-[#6f5b4f]">
                        Created by {study.creator.name}
                        {study.creator.organization ? ` (${study.creator.organization})` : ""}
                      </p>
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
                        href={`/studies/${study.id}/start`}
                        className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                      >
                        {myParticipation ? "Continue Evaluation" : "Start Evaluation"}
                      </Link>
                      {myParticipation && (
                        <span className="inline-flex items-center justify-center rounded-lg bg-[#edf5ff] px-4 py-2 text-sm font-medium text-[#1e4f8f]">
                          {myParticipation.status}
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </CollapsibleSection>
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
        <CollapsibleSection id="study-pipeline" title="Study Pipeline" countLabel={`${filteredStudies.length}`} defaultOpen={true}>
          <StudyPipelineList studies={filteredStudies} redirectTo="/msme/dashboard?view=history" />
        </CollapsibleSection>
      )}
    </DashboardShell>
  );
}

function parseMSMEView(value?: string) {
  if (
    value === "profile" ||
    value === "create-study" ||
    value === "import-dataset" ||
    value === "history" ||
    value === "evaluate" ||
    value === "projects"
  ) {
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
