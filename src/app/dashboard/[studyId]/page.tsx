import { ResultsDashboard } from "@/components/dashboard/results-dashboard";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";

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
  if (session.role === "MSME") {
    const ownedStudy = await prisma.study.findFirst({
      where: { id: studyId, creatorId: session.userId },
      select: { id: true },
    });
    if (!ownedStudy) {
      notFound();
    }
  }

  return <ResultsDashboard studyId={studyId} />;
}
