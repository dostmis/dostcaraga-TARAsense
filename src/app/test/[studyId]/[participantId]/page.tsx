import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SensoryTestInterface } from "@/components/sensory-test/test-interface";
import { getCurrentGuestSession, getCurrentSession } from "@/lib/auth/session";

type PageProps = {
  params: Promise<{ studyId: string; participantId: string }>;
};

export default async function SensoryTestPage({ params }: PageProps) {
  const { studyId, participantId } = await params;
  const session = await getCurrentSession();
  const guestSession = await getCurrentGuestSession();
  const isGuest = !session && guestSession?.studyId === studyId;

  if (!session && !isGuest) {
    redirect("/login?error=Please+login+to+continue");
  }
  if (session && !["CONSUMER", "MSME", "ADMIN"].includes(session.role)) {
    notFound();
  }

  const participant = (await prisma.studyParticipant.findFirst({
    where: {
      id: participantId,
      studyId,
    },
    select: {
      status: true,
      source: true,
      panelist: {
        select: {
          userId: true,
        },
      },
      consentStatus: true,
      study: {
        select: {
          creatorId: true,
          productName: true,
          targetDemographics: true,
          sensoryAttributes: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              name: true,
              type: true,
              jarOptions: true,
            },
          },
        },
      },
    },
  })) as
    | {
        status: "SELECTED" | "WAITLIST" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "DECLINED";
        source: "REGISTERED_CONSUMER" | "WALK_IN_GUEST";
        panelist: {
          userId: string | null;
        };
        consentStatus: "PENDING" | "AGREED" | "DECLINED";
        study: {
          creatorId: string;
          productName: string;
          targetDemographics: unknown;
          sensoryAttributes: Array<{
            id: string;
            name: string;
            type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
            jarOptions: unknown;
          }>;
        };
      }
    | null;

  if (!participant) {
    notFound();
  }
  if (session?.role === "CONSUMER" && participant.panelist.userId !== session.userId) {
    notFound();
  }
  if (session?.role === "CONSUMER" && participant.consentStatus !== "AGREED") {
    redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&error=Please+complete+consent+before+evaluation`);
  }
  if (isGuest) {
    if (!guestSession || participant.source !== "WALK_IN_GUEST" || participantId !== guestSession.participantId) {
      notFound();
    }
    if (participant.consentStatus !== "AGREED") {
      redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&guest=1&error=Please+complete+consent+before+evaluation`);
    }
  }
  if (session?.role === "MSME" && participant.study.creatorId !== session.userId) {
    notFound();
  }
  if (session?.role === "MSME" && participant.study.creatorId === session.userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] px-4">
        <div className="w-full max-w-md rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-semibold">MSME self-evaluation is disabled</h1>
          <p className="mt-2 text-[#64748b]">
            MSME users cannot answer their own created studies. Please use a consumer account or share the QR form.
          </p>
          <Link className="mt-4 inline-block font-medium text-[#f97316] hover:text-[#ea580c]" href="/msme/dashboard">
            Return to MSME Dashboard
          </Link>
        </div>
      </div>
    );
  }
  if (participant.status === "COMPLETED") {
    redirect(`/test/completed?studyId=${studyId}`);
  }

  if (participant.study.sensoryAttributes.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] px-4">
        <div className="w-full max-w-md rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-semibold">No test attributes were configured</h1>
          <p className="mt-2 text-[#64748b]">
            Add sensory attributes to this study before launching test sessions.
          </p>
          <Link className="mt-4 inline-block font-medium text-[#f97316] hover:text-[#ea580c]" href="/dashboard">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const attributes = participant.study.sensoryAttributes.map((attribute: {
    id: string;
    name: string;
    type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
    jarOptions: unknown;
  }) => ({
    id: attribute.id,
    name: attribute.name,
    type: attribute.type,
    jarOptions:
      attribute.jarOptions && typeof attribute.jarOptions === "object"
        ? (attribute.jarOptions as { low?: string; mid?: string; high?: string })
        : null,
  }));
  const sampleCount = resolveStudySampleCount(participant.study.targetDemographics);

  return (
    <SensoryTestInterface
      studyId={studyId}
      participantId={participantId}
      attributes={attributes}
      productName={participant.study.productName}
      sampleCount={sampleCount}
    />
  );
}

function resolveStudySampleCount(value: unknown) {
  if (!value || typeof value !== "object") {
    return 1;
  }

  const data = value as { numberOfSamples?: unknown };
  if (typeof data.numberOfSamples !== "number" || !Number.isFinite(data.numberOfSamples)) {
    return 1;
  }

  return Math.max(1, Math.floor(data.numberOfSamples));
}
