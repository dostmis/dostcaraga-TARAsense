import Link from "next/link";
import { logout } from "@/app/actions/auth-actions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ProfileWorkspace } from "@/components/profile/profile-workspace";
import { FicAvailabilityCalendar } from "@/components/fic-availability-calendar";
import { formatPanelistNumber } from "@/lib/participant-assignment";
import { CalendarDays, ClipboardCheck, Clock3, LayoutDashboard, MapPin, TestTube2, UserRound } from "lucide-react";
import { isMissingColumnError, logSchemaDriftWarning } from "@/lib/db-schema-drift";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
const FIC_TIMEZONE = "Asia/Manila";

type PageProps = {
  searchParams: Promise<{ view?: string; error?: string; message?: string; q?: string }>;
};

type CalendarEvent = {
  id: string;
  studyId: string;
  studyTitle: string;
  productName: string;
  location: string;
  panelistName: string;
  panelistNumber: string;
  sessionState: "CONFIRMED" | "PENDING_CONFIRMATION";
  scheduledAt: Date;
  msmeName: string;
  msmeOrganization: string | null;
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
  const normalizedQuery = (q ?? "").trim().toLowerCase();
  const shouldLoadQueueStudies = activeView === "queue";
  const shouldLoadCalendarSessions = activeView === "calendar";
  const now = new Date();
  const ficAssignment =
    session.role === "FIC"
      ? await prisma.user.findUnique({
          where: { id: session.userId },
          select: { assignedRegion: true, assignedFacility: true },
        })
      : null;
  const ficStudyWhere: Prisma.StudyWhereInput =
    session.role === "FIC"
      ? {
          location: ficAssignment?.assignedFacility
            ? { equals: ficAssignment.assignedFacility, mode: "insensitive" as const }
            : { equals: "__UNASSIGNED_FIC_FACILITY__", mode: "insensitive" as const },
        }
      : {
          OR: [
            {
              targetDemographics: {
                path: ["coordinationMode"],
                equals: "FIC_ASSISTED",
              },
            },
            { location: { contains: "fic", mode: "insensitive" as const } },
          ],
        };
  const assignmentMessage =
    session.role === "FIC" && !ficAssignment?.assignedFacility
      ? "Your FIC account has not been assigned to a facility yet. Ask an admin to set your region and facility."
      : null;

  let studiesForQueue: Array<{
    id: string;
    title: string;
    productName: string;
    location: string;
    status: string;
    creator: { name: string; organization: string | null };
    _count: { responses: number; participants: number };
  }> = [];
  let participantSessionsForCalendar: Array<{
    id: string;
    panelistNumber: number | null;
    status: string;
    sessionAt: Date | null;
    requestedSessionAt: Date | null;
    study: {
      id: string;
      title: string;
      productName: string;
      location: string;
      creator: { name: string; organization: string | null };
    };
    panelist: { name: string };
  }> = [];
  let uploadedStudyCount = 0;
  let ficStudyCount = 0;
  let activeStudyCount = 0;
  let totalResponseCount = 0;
  let upcomingSessionCount = 0;
  let pendingSessionCount = 0;

  try {
    [
      studiesForQueue,
      participantSessionsForCalendar,
      uploadedStudyCount,
      ficStudyCount,
      activeStudyCount,
      totalResponseCount,
      upcomingSessionCount,
      pendingSessionCount,
    ] = await Promise.all([
      shouldLoadQueueStudies
        ? prisma.study.findMany({
            where: ficStudyWhere,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              title: true,
              productName: true,
              location: true,
              status: true,
              creator: { select: { name: true, organization: true } },
              _count: { select: { responses: true, participants: true } },
            },
            take: 20,
          })
        : Promise.resolve([]),
      shouldLoadCalendarSessions
        ? prisma.studyParticipant.findMany({
            where: {
              OR: [{ sessionAt: { not: null } }, { requestedSessionAt: { not: null } }],
              status: { in: ["WAITLIST", "SELECTED", "CONFIRMED"] },
              study: ficStudyWhere,
            },
            select: {
              id: true,
              panelistNumber: true,
              status: true,
              sessionAt: true,
              requestedSessionAt: true,
              study: {
                select: {
                  id: true,
                  title: true,
                  productName: true,
                  location: true,
                  creator: {
                    select: {
                      name: true,
                      organization: true,
                    },
                  },
                },
              },
              panelist: {
                select: {
                  name: true,
                },
              },
            },
            take: 300,
          })
        : Promise.resolve([]),
      prisma.study.count(),
      prisma.study.count({
        where: ficStudyWhere,
      }),
      prisma.study.count({
        where: {
          status: { in: ["ACTIVE", "RECRUITING"] },
        },
      }),
      prisma.sensoryResponse.count(),
      prisma.studyParticipant.count({
        where: {
          status: { in: ["WAITLIST", "SELECTED", "CONFIRMED"] },
          study: ficStudyWhere,
          OR: [{ sessionAt: { gte: now } }, { requestedSessionAt: { gte: now } }],
        },
      }),
      prisma.studyParticipant.count({
        where: {
          status: { in: ["WAITLIST", "SELECTED", "CONFIRMED"] },
          sessionAt: null,
          requestedSessionAt: { gte: now },
          study: ficStudyWhere,
        },
      }),
    ]);
  } catch (error) {
    if (isMissingColumnError(error, "StudyParticipant")) {
      logSchemaDriftWarning("fic dashboard participant sessions", error);
      redirect("/fic/dashboard?error=Database+schema+is+out+of+date.+Run+npm+run+db:sync");
    }
    throw error;
  }

  const filteredStudies = normalizedQuery
    ? studiesForQueue.filter((study) => {
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
    : studiesForQueue;

  const filteredParticipantSessions = normalizedQuery
    ? participantSessionsForCalendar.filter((row) => {
        const entry = [
          row.study.title,
          row.study.productName,
          row.study.location,
          row.study.creator.name,
          row.study.creator.organization ?? "",
          row.panelist.name,
          row.status,
          formatPanelistNumber(row.panelistNumber),
        ]
          .join(" ")
          .toLowerCase();
        return entry.includes(normalizedQuery);
      })
    : participantSessionsForCalendar;

  const calendarEvents = filteredParticipantSessions
    .map<CalendarEvent | null>((row) => {
      const scheduledAt = row.sessionAt ?? row.requestedSessionAt;
      if (!scheduledAt) {
        return null;
      }
      return {
        id: row.id,
        studyId: row.study.id,
        studyTitle: row.study.title,
        productName: row.study.productName,
        location: row.study.location,
        panelistName: row.panelist.name,
        panelistNumber: formatPanelistNumber(row.panelistNumber),
        sessionState: row.sessionAt ? "CONFIRMED" : "PENDING_CONFIRMATION",
        scheduledAt,
        msmeName: row.study.creator.name,
        msmeOrganization: row.study.creator.organization,
      };
    })
    .filter((event): event is CalendarEvent => Boolean(event))
    .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());

  const todayKey = getDateKeyInTimezone(new Date(), FIC_TIMEZONE);
  const upcomingCalendarEvents = calendarEvents.filter(
    (event) => getDateKeyInTimezone(event.scheduledAt, FIC_TIMEZONE) >= todayKey
  );
  const calendarGroups = groupCalendarByDate(upcomingCalendarEvents, FIC_TIMEZONE);

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
          badge: `${ficStudyCount}`,
          active: activeView === "queue",
        },
        {
          label: "FIC Calendar",
          href: "/fic/dashboard?view=calendar",
          icon: CalendarDays,
          badge: `${upcomingSessionCount}`,
          active: activeView === "calendar",
        },
      ]}
      stats={[
        { label: "Booking Notifications", value: `${ficStudyCount}`, helper: "Studies tagged for FIC facilities", icon: MapPin, tone: "amber" },
        { label: "Upcoming Sessions", value: `${upcomingSessionCount}`, helper: "Requested + confirmed session slots", icon: CalendarDays, tone: "sky" },
        { label: "Pending Confirmation", value: `${pendingSessionCount}`, helper: "Waiting MSME session confirmation", icon: Clock3, tone: "amber" },
        { label: "Uploaded Studies", value: `${uploadedStudyCount}`, helper: "Visible MSME study submissions", icon: TestTube2, tone: "sky" },
        { label: "Active Studies", value: `${activeStudyCount}`, helper: "Recruiting or currently running", icon: LayoutDashboard, tone: "mint" },
        { label: "Total Responses", value: `${totalResponseCount}`, helper: "Responses across visible studies", icon: ClipboardCheck, tone: "slate" },
      ]}
      sidebarFooter={
        <form action={logout}>
          <button type="submit" className="app-button-secondary w-full py-2 text-sm">
            Logout
          </button>
        </form>
      }
    >
      {assignmentMessage && (
        <section className="rounded-xl border border-[#f5c2c7] bg-[#fff1f2] p-4 text-sm text-[#9f1239]">
          {assignmentMessage}
        </section>
      )}

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

      {activeView === "calendar" && (
        <div className="space-y-6">
          {/* Availability Calendar */}
          <CollapsibleSection id="fic-availability" title="My Availability Calendar" defaultOpen={true}>
            <FicAvailabilityCalendar ficUserId={session.userId} />
          </CollapsibleSection>

          {/* Session Calendar */}
          <CollapsibleSection id="fic-calendar" title="Booked Sessions Calendar" countLabel={`${upcomingCalendarEvents.length}`} defaultOpen={true}>
            <div className="space-y-4">
              <article className="rounded-2xl border border-[#e4d7cc] bg-white p-5 text-sm text-[#6f5b4f]">
                <p>
                  Calendar timezone: <span className="font-semibold text-[#2e231c]">{FIC_TIMEZONE}</span>
                </p>
                <p className="mt-1">
                  Showing requested and confirmed sessions for FIC-tagged studies starting today.
                </p>
              </article>

              {calendarGroups.length === 0 && (
                <article className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                  <h2 className="text-lg font-semibold text-[#2e231c]">No upcoming sessions</h2>
                  <p className="mt-1 text-sm text-[#6f5b4f]">
                    Once MSMEs send schedule options and confirm slots, they will appear here.
                  </p>
                </article>
              )}

              {calendarGroups.map((group) => (
                <article key={group.dateKey} className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-semibold text-[#2e231c]">{group.dateLabel}</h2>
                    <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-xs font-medium text-[#695446]">
                      {group.events.length} session(s)
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {group.events.map((event) => (
                      <div key={event.id} className="rounded-xl border border-[#eadfd6] bg-[#fffdfb] p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <h3 className="text-base font-semibold text-[#2e231c]">{event.studyTitle}</h3>
                            <p className="mt-1 text-sm text-[#6f5b4f]">{event.productName}</p>
                            <p className="mt-2 text-xs text-[#8c776a]">
                              Panelist {event.panelistNumber}: {event.panelistName}
                            </p>
                            <p className="mt-1 text-xs text-[#8c776a]">
                              MSME: {event.msmeName}
                              {event.msmeOrganization ? ` (${event.msmeOrganization})` : ""}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                              <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{event.location}</span>
                              <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-[#1e4f8f]">
                                {formatTimeInTimezone(event.scheduledAt, FIC_TIMEZONE)}
                              </span>
                              <span
                                className={
                                  event.sessionState === "CONFIRMED"
                                    ? "rounded-full bg-[#e8f8ed] px-2.5 py-1 text-[#1d7c4a]"
                                    : "rounded-full bg-[#fff7e9] px-2.5 py-1 text-[#8a5a00]"
                                }
                              >
                                {event.sessionState === "CONFIRMED" ? "Confirmed" : "Pending MSME Confirmation"}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 self-start">
                            <Link
                              href={`/studies/${event.studyId}/form`}
                              className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                            >
                              Open Study
                            </Link>
                            <Link
                              href={`/dashboard/${event.studyId}`}
                              className="inline-flex items-center justify-center rounded-lg bg-[#ed7f2a] px-4 py-2 text-sm font-medium text-white hover:bg-[#dc6f1d]"
                            >
                              View Dashboard
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}
    </DashboardShell>
  );
}

function parseFicView(value?: string) {
  if (value === "profile" || value === "queue" || value === "calendar") {
    return value;
  }
  return "dashboard";
}

function groupCalendarByDate(events: CalendarEvent[], timezone: string) {
  const grouped = new Map<string, CalendarEvent[]>();
  events.forEach((event) => {
    const key = getDateKeyInTimezone(event.scheduledAt, timezone);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(event);
      return;
    }
    grouped.set(key, [event]);
  });

  return Array.from(grouped.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([dateKey, rows]) => ({
      dateKey,
      dateLabel: formatDateHeading(rows[0].scheduledAt, timezone),
      events: rows.sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime()),
    }));
}

function getDateKeyInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatDateHeading(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTimeInTimezone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
