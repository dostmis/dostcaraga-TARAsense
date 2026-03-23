import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { submitStudyConsent, verifyPanelistNumber } from "@/app/actions/participant-actions";
import { formatPanelistNumber, parseSampleCodes } from "@/lib/participant-assignment";

type PageProps = {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<{ error?: string; participantId?: string; verified?: string }>;
};

export default async function StartStudyPage({ params, searchParams }: PageProps) {
  await requireRole(["CONSUMER"]);
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?error=Please+login+to+start+a+survey");
  }

  const { studyId } = await params;
  const query = await searchParams;
  const error = query.error ? decodeURIComponent(query.error) : undefined;
  const participantId = typeof query.participantId === "string" ? query.participantId : "";
  const verified = query.verified === "1";

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      productName: true,
      status: true,
      sensoryAttributes: { select: { id: true }, take: 1 },
    },
  });

  if (!study) {
    notFound();
  }
  if (!["RECRUITING", "ACTIVE"].includes(study.status)) {
    redirect(`/consumer/dashboard?view=available&error=This+study+is+not+open+for+responses`);
  }
  if (study.sensoryAttributes.length === 0) {
    redirect(`/consumer/dashboard?view=available&error=This+study+has+no+questionnaire+yet`);
  }

  const panelist = await prisma.panelist.findFirst({
    where: {
      userId: session.userId,
    },
    select: { id: true },
  });

  const participant =
    verified && participantId && panelist
      ? await prisma.studyParticipant.findFirst({
          where: {
            id: participantId,
            studyId: study.id,
            panelistId: panelist.id,
            status: { in: ["SELECTED", "CONFIRMED"] },
          },
          select: {
            id: true,
            status: true,
            panelistNumber: true,
            randomizeCode: true,
            sampleCodes: true,
            consentStatus: true,
          },
        })
      : null;

  if (participant?.status === "COMPLETED") {
    redirect(`/test/completed?studyId=${study.id}`);
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#9a5822]">Study Access</p>
          <h1 className="mt-2 text-2xl font-semibold text-[#0f172a]">{study.title}</h1>
          <p className="mt-1 text-sm text-[#64748b]">{study.productName}</p>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </section>

        {!participant && (
          <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6">
            <h2 className="text-lg font-semibold text-[#0f172a]">Enter Panelist Number</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              Input your assigned panelist number to view your randomize sample codes and proceed to consent.
            </p>
            <form action={verifyPanelistNumber} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="studyId" value={study.id} />
              <label className="flex-1 text-sm text-[#64748b]">
                Panelist Number
                <input
                  type="number"
                  name="panelistNumber"
                  min={1}
                  className="mt-1 w-full rounded-lg border border-[#dbe3ec] px-3 py-2"
                  placeholder="e.g. 1"
                  required
                />
              </label>
              <button type="submit" className="app-button-primary rounded-lg px-5 py-2 text-sm">
                Proceed
              </button>
            </form>
          </section>
        )}

        {participant && (
          <>
            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6">
              <h2 className="text-lg font-semibold text-[#0f172a]">Assigned Sample Randomize Codes</h2>
              <p className="mt-1 text-sm text-[#64748b]">
                Panelist No: {formatPanelistNumber(participant.panelistNumber)} | Use these codes to match your physical samples.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {renderSampleCodes(participant.sampleCodes, participant.randomizeCode).map((row) => (
                  <div key={`${row.sample}-${row.code}`} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm">
                    <p className="font-medium text-[#0f172a]">Sample {row.sample}</p>
                    <p className="text-[#64748b]">Code: {row.code}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6">
              <h2 className="text-lg font-semibold text-[#0f172a]">TARAsense Sensory Evaluation Consent (Short Form)</h2>
              <p className="mt-2 text-sm text-[#64748b]">Please read before continuing.</p>
              <div className="mt-4 space-y-3 text-sm text-[#64748b]">
                <p>You are invited to participate in a food sensory evaluation conducted through TARAsense.</p>
                <p className="font-semibold text-[#0f172a]">WHAT PARTICIPATION INVOLVES</p>
                <p>- Tasting one or more food or beverage samples</p>
                <p>- Answering short questions about taste, texture, and overall acceptability</p>
                <p>- The activity takes about 5-15 minutes</p>
                <p className="font-semibold text-[#0f172a]">VOLUNTARY PARTICIPATION</p>
                <p>- Your participation is voluntary</p>
                <p>- You may stop at any time or skip any question</p>
                <p>- There is no penalty for not participating</p>
                <p className="font-semibold text-[#0f172a]">RISKS</p>
                <p>- Risks are minimal and similar to everyday food consumption</p>
                <p>- Do not participate if you have food allergies, sensitivities, or dietary restrictions</p>
                <p className="font-semibold text-[#0f172a]">CONFIDENTIALITY</p>
                <p>- Your responses are anonymous</p>
                <p>- Data will be analyzed and reported only in aggregated form</p>
                <p>- Results are used only for product development</p>
                <p className="font-semibold text-[#0f172a]">NO OBLIGATION</p>
                <p>- You are not required to buy, endorse, or promote any product</p>
                <p className="font-semibold text-[#0f172a]">CONSENT</p>
                <p>By selecting &quot;I Agree&quot;, you confirm that:</p>
                <p>- You are 18-65 years old or above</p>
                <p>- Not pregnant</p>
                <p>- You have read and understood the information above</p>
                <p>- You voluntarily agree to participate</p>
              </div>

              <form action={submitStudyConsent} className="mt-6 space-y-4">
                <input type="hidden" name="studyId" value={study.id} />
                <input type="hidden" name="participantId" value={participant.id} />
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="decision" value="AGREE" required />
                    <span>I Agree</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="decision" value="DECLINE" required />
                    <span>I Do Not Agree</span>
                  </label>
                </div>
                <button type="submit" className="app-button-primary rounded-lg px-5 py-2 text-sm">
                  Continue
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function renderSampleCodes(sampleCodesValue: unknown, fallbackCode: string | null) {
  const parsed = parseSampleCodes(sampleCodesValue);
  if (parsed.length > 0) {
    return parsed;
  }
  return [{ sample: 1, code: fallbackCode ?? "N/A" }];
}

