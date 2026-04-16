import { ResultsDashboard } from "@/components/dashboard/results-dashboard";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { canAccessStudyByRole } from "@/lib/study-access";

type PageProps = {
  params: Promise<{ studyId: string }>;
};

export default async function StudyDashboardPage({ params }: PageProps) {
  await requireRole(["MSME", "FIC", "ADMIN"]);
  const session = await getCurrentSession();
  const { studyId } = await params;

  if (!session) {
    notFound();
  }
  const [study, currentUser] = await Promise.all([
    prisma.study.findUnique({
      where: { id: studyId },
      select: { id: true, creatorId: true, location: true },
    }),
    session.role === "FIC"
      ? prisma.user.findUnique({
          where: { id: session.userId },
          select: { assignedFacility: true },
        })
      : Promise.resolve(null),
  ]);
  if (!study) {
    notFound();
  }
  if (
    !canAccessStudyByRole({
      role: session.role,
      userId: session.userId,
      studyCreatorId: study.creatorId,
      studyLocation: study.location,
      ficAssignedFacility: currentUser?.assignedFacility,
    })
  ) {
    notFound();
  }

  return <ResultsDashboard studyId={studyId} />;
}
