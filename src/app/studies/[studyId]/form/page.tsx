import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { confirmParticipantSession, offerScheduleOptions } from "@/app/actions/participant-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession, requireRole } from "@/lib/auth/session";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { formatPanelistNumber, parseOfferedSessions, parseSampleCodes } from "@/lib/participant-assignment";
import { formatSessionWindow, parseStudySessionSchedule } from "@/lib/study-schedule";
import { PageShell, SurfaceCard } from "@/components/ui/page-shell";

type PageProps = {
  params: Promise<{ studyId: string }>;
};

interface StudyMeta {
  studyMode?: "MARKET" | "SENSORY";
  marketStudyType?: string;
  sensoryStudyType?: string;
  sensoryMethod?: string;
  consumerObjective?: string;
  categoryLabel?: string;
  numberOfSamples?: number;
}

export default async function StudyFormPage({ params }: PageProps) {
  await requireRole(["MSME", "FIC", "CONSUMER", "ADMIN"]);
  const session = await getCurrentSession();
  const { studyId } = await params;
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      sensoryAttributes: {
        orderBy: { order: "asc" },
      },
      participants: {
        where: { status: { in: ["SELECTED", "CONFIRMED", "WAITLIST"] } },
        orderBy: [{ panelistNumber: "asc" }, { selectionOrder: "asc" }],
        select: {
          id: true,
          panelistNumber: true,
          randomizeCode: true,
          sampleCodes: true,
          offeredSessions: true,
          requestedSessionAt: true,
          sessionAt: true,
          selectionOrder: true,
          status: true,
          panelist: { select: { name: true, userId: true } },
        },
      },
    },
  });

  if (!study) {
    notFound();
  }
  if (session?.role === "MSME" && study.creatorId !== session.userId) {
    notFound();
  }

  const meta = toStudyMeta(study.targetDemographics);
  const criteria = toCriteria(study.screeningCriteria);
  const sessionSchedule = parseStudySessionSchedule(study.targetDemographics);
  const isMarketStudy = meta.studyMode === "MARKET";
  const sampleCodes = buildSampleCodes(study.id, Math.max(meta.numberOfSamples ?? 3, 1));
  const overallLikingQuestion = study.sensoryAttributes.find((attribute) => attribute.type === "OVERALL_LIKING");
  const attributeLikingQuestions = study.sensoryAttributes.filter((attribute) => attribute.type === "ATTRIBUTE_LIKING");
  const jarQuestions = study.sensoryAttributes.filter((attribute) => attribute.type === "JAR");
  const openEndedQuestions = study.sensoryAttributes.filter((attribute) => attribute.type === "OPEN_ENDED");

  const participantLink =
    session?.role === "CONSUMER"
      ? `/studies/${study.id}/start`
      : study.participants[0]
        ? `/test/${study.id}/${study.participants[0].id}`
        : `/dashboard/${study.id}`;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const qrTargetPath = isMarketStudy ? `/studies/${study.id}/form` : participantLink;
  const qrTargetUrl = `${baseUrl.replace(/\/$/, "")}${qrTargetPath}`;
  const qrDataUrl = await QRCode.toDataURL(qrTargetUrl, { width: 280, margin: 1 });
  const dashboardHref = session ? ROLE_DASHBOARD_PATH[session.role] : "/dashboard";

  return (
    <PageShell maxWidthClassName="max-w-6xl">
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <SurfaceCard className="space-y-6">
          <header className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[#ea580c]">
              {isMarketStudy ? "Survey Form" : "Sensory Score Sheet"}
            </p>
            <h1 className="text-2xl font-bold text-[#0f172a]">{study.title}</h1>
            <p className="text-[#64748b]">{study.description || "No purpose provided."}</p>
          </header>

          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <Info label="Product / Study Type" value={study.productName} />
            <Info label="Category" value={meta.categoryLabel || study.category} />
            <Info label="Facility Type" value={study.location} />
            <Info label="Target Responses" value={`${study.sampleSize}`} />
            <Info label="No. of Samples" value={`${meta.numberOfSamples ?? "N/A"}`} />
            <Info
              label="Method"
              value={
                isMarketStudy
                  ? humanize(meta.marketStudyType || "MARKET")
                  : `${humanize(meta.sensoryStudyType || "SENSORY")} / ${meta.sensoryMethod || "-"}`
              }
            />
          </div>

          {isMarketStudy ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-[#0f172a]">Survey Questions</h2>
              <ol className="list-decimal pl-5 space-y-2 text-[#64748b]">
                {criteria.questions.length > 0 ? (
                  criteria.questions.map((question) => <li key={question}>{question}</li>)
                ) : (
                  <li>No custom market questions set.</li>
                )}
              </ol>
            </section>
          ) : (
            <div className="space-y-4">
              <section className="rounded-xl border p-4">
                <h2 className="text-lg font-semibold text-[#0f172a]">Study Introduction</h2>
                <p className="mt-2 text-sm text-[#64748b]">
                  You will evaluate the product samples based on personal liking and perception.
                  There are no right or wrong answers. Please rinse your mouth between samples.
                </p>
              </section>

              <section className="rounded-xl border p-4">
                <h2 className="text-lg font-semibold text-[#0f172a]">Sample Order (Randomized)</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  {sampleCodes.map((code) => (
                    <span key={code} className="rounded-full border border-[#fed7aa] bg-[#fff7ed] px-3 py-1 text-[#ea580c]">
                      Sample {code}
                    </span>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border p-4 space-y-2">
                <h2 className="text-lg font-semibold text-[#0f172a]">Section 1 - Overall Liking</h2>
                <p className="text-sm text-[#64748b]">
                  {overallLikingQuestion?.name ?? "How much do you like this sample overall?"}
                </p>
                <p className="text-xs text-[#64748b]">
                  9-point hedonic scale: 1 = Dislike Extremely, 5 = Neither Like nor Dislike, 9 = Like Extremely
                </p>
              </section>

              <section className="rounded-xl border p-4 space-y-2">
                <h2 className="text-lg font-semibold text-[#0f172a]">Section 2 - Attribute Liking</h2>
                {attributeLikingQuestions.length === 0 ? (
                  <p className="text-sm text-[#64748b]">No attribute liking questions configured.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm text-[#64748b] space-y-1">
                    {attributeLikingQuestions.map((attribute) => (
                      <li key={attribute.id}>{attribute.name} (9-point scale)</li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border p-4 space-y-2">
                <h2 className="text-lg font-semibold text-[#0f172a]">Section 3 - JAR Scale</h2>
                {jarQuestions.length === 0 ? (
                  <p className="text-sm text-[#64748b]">No JAR questions configured.</p>
                ) : (
                  <div className="space-y-3">
                    {jarQuestions.map((attribute) => {
                      const options = parseJarOptions(attribute.jarOptions);
                      return (
                        <div key={attribute.id} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                          <p className="text-sm font-medium text-[#0f172a]">{attribute.name}</p>
                          <p className="mt-1 text-xs text-[#64748b]">
                            {options.low} / {options.mid} / {options.high}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-xl border p-4 space-y-2">
                <h2 className="text-lg font-semibold text-[#0f172a]">Section 4 - Purchase Intent</h2>
                <p className="text-sm text-[#64748b]">If available in the market, would you buy this product?</p>
                <ul className="text-sm text-[#64748b] list-disc pl-5 space-y-1">
                  <li>Definitely would buy</li>
                  <li>Probably would buy</li>
                  <li>Might or might not buy</li>
                  <li>Probably would not buy</li>
                  <li>Definitely would not buy</li>
                </ul>
              </section>

              <section className="rounded-xl border p-4 space-y-2">
                <h2 className="text-lg font-semibold text-[#0f172a]">Section 5 - Open Feedback</h2>
                <ul className="text-sm text-[#64748b] list-disc pl-5 space-y-1">
                  {openEndedQuestions.length > 0 ? (
                    openEndedQuestions.map((attribute) => <li key={attribute.id}>{attribute.name}</li>)
                  ) : (
                    <>
                      <li>What did you like about this product?</li>
                      <li>What should be improved?</li>
                    </>
                  )}
                </ul>
              </section>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[#0f172a]">Sample Set-ups</h2>
            {criteria.sampleSetups.length === 0 && <p className="text-[#64748b]">No sample setup details provided.</p>}
            <div className="grid md:grid-cols-2 gap-4">
              {criteria.sampleSetups.map((setup, index) => (
                <div key={`${setup.description}-${index}`} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm space-y-1">
                  <h3 className="font-medium">Set-up {index + 1}</h3>
                  <p>
                    <span className="font-medium">Description:</span> {setup.description}
                  </p>
                  <p>
                    <span className="font-medium">Ingredient:</span> {setup.ingredient || "N/A"}
                  </p>
                  <p>
                    <span className="font-medium">Allergen:</span> {setup.allergen}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {sessionSchedule && !isMarketStudy && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-[#0f172a]">Testing Session Plan</h2>
              <p className="text-sm text-[#64748b]">Timezone: {sessionSchedule.timezone}</p>
              <div className="space-y-2">
                {sessionSchedule.slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm"
                  >
                    <p className="text-[#0f172a]">{formatSessionWindow(slot, sessionSchedule.timezone)}</p>
                    <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-xs font-medium text-[#1e4f8f]">
                      Capacity: {slot.capacity}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!isMarketStudy && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-[#0f172a]">Configured Questionnaire Items</h2>
              <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-[#f8fafc]">
                    <tr>
                      <th className="px-4 py-2 text-left">Question</th>
                      <th className="px-4 py-2 text-left">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {study.sensoryAttributes.map((attribute) => (
                      <tr key={attribute.id} className="border-t">
                        <td className="px-4 py-2">{attribute.name}</td>
                        <td className="px-4 py-2">{attribute.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </SurfaceCard>

        <SurfaceCard className="h-fit space-y-4">
          <h2 className="text-lg font-semibold text-[#0f172a]">QR Code</h2>
          <p className="text-sm text-[#64748b]">
            {isMarketStudy
              ? "Use this QR to open the generated survey form."
              : "Use this QR to open the sensory form for the next available participant."}
          </p>
          <Image
            src={qrDataUrl}
            alt="Study QR Code"
            width={280}
            height={280}
            unoptimized
            className="w-full rounded-lg border"
          />
          <p className="break-all text-xs text-[#64748b]">{qrTargetUrl}</p>

          <div className="space-y-2">
            <Link
              href={qrTargetPath}
              className="app-button-primary inline-flex w-full items-center justify-center py-2"
            >
              {session?.role === "CONSUMER" ? "START" : "Open Linked Form"}
            </Link>
            {session?.role !== "CONSUMER" && (
              <>
                <Link
                  href={`/dashboard/${study.id}`}
                  className="app-button-secondary inline-flex w-full items-center justify-center py-2"
                >
                  Open Dashboard
                </Link>
                <a
                  href={`/api/studies/${study.id}/master-list`}
                  className="app-button-secondary inline-flex w-full items-center justify-center py-2"
                >
                  Export Master List (CSV)
                </a>
              </>
            )}
            <Link
              href={dashboardHref}
              className="app-button-secondary inline-flex w-full items-center justify-center py-2"
            >
              Back to Dashboard
            </Link>
          </div>

          {!isMarketStudy && study.participants.length > 0 && (
            <div className="border-t border-[#e2e8f0] pt-2">
              <h3 className="mb-2 text-sm font-semibold text-[#0f172a]">Participant Queue</h3>
              <div className="space-y-2 text-xs text-[#64748b]">
                {study.participants.slice(0, 8).map((participant) => (
                  <div key={participant.id} className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-2">
                    <p>
                      {formatPanelistNumber(participant.panelistNumber)} | {participant.panelist.name} | {participant.status}
                    </p>
                    <p className="mt-1 text-[11px] text-[#8a725f]">
                      Codes: {parseSampleCodes(participant.sampleCodes).map((row) => `S${row.sample}:${row.code}`).join(", ") || participant.randomizeCode || "Unassigned"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isMarketStudy && (session?.role === "MSME" || session?.role === "ADMIN") && study.participants.length > 0 && (
            <div className="border-t border-[#e2e8f0] pt-3">
              <h3 className="mb-2 text-sm font-semibold text-[#0f172a]">MSME Scheduling Controls</h3>
              <div className="space-y-3">
                {study.participants.map((participant) => {
                  const offered = parseOfferedSessions(participant.offeredSessions);
                  const requested = participant.requestedSessionAt ? new Date(participant.requestedSessionAt) : null;
                  const confirmed = participant.sessionAt ? new Date(participant.sessionAt) : null;
                  return (
                    <div key={`${participant.id}-schedule`} className="rounded-lg border border-[#e2e8f0] bg-[#fffdfb] p-3 space-y-2">
                      <p className="text-xs font-medium text-[#0f172a]">
                        {participant.panelist.name} ({formatPanelistNumber(participant.panelistNumber)}) - {participant.status}
                      </p>
                      {offered.length > 0 && (
                        <p className="text-[11px] text-[#64748b]">Offered: {offered.map((value) => new Date(value).toLocaleString()).join(" | ")}</p>
                      )}
                      {requested && (
                        <p className="text-[11px] text-[#1d4ed8]">Consumer selected: {requested.toLocaleString()}</p>
                      )}
                      {confirmed && (
                        <p className="text-[11px] text-[#047857]">Confirmed: {confirmed.toLocaleString()}</p>
                      )}

                      <form action={offerScheduleOptions} className="grid gap-2">
                        <input type="hidden" name="studyId" value={study.id} />
                        <input type="hidden" name="participantId" value={participant.id} />
                        <input type="hidden" name="redirectTo" value={`/studies/${study.id}/form`} />
                        <input type="datetime-local" name="option1" className="rounded-md border border-[#dbe3ec] px-2 py-1 text-xs" />
                        <input type="datetime-local" name="option2" className="rounded-md border border-[#dbe3ec] px-2 py-1 text-xs" />
                        <input type="datetime-local" name="option3" className="rounded-md border border-[#dbe3ec] px-2 py-1 text-xs" />
                        <button type="submit" className="rounded-md border border-[#f97316] bg-[#f97316] px-3 py-1 text-xs font-semibold text-white hover:bg-[#ea580c]">
                          Send Schedule Options
                        </button>
                      </form>

                      {requested && !confirmed && (
                        <form action={confirmParticipantSession}>
                          <input type="hidden" name="studyId" value={study.id} />
                          <input type="hidden" name="participantId" value={participant.id} />
                          <input type="hidden" name="redirectTo" value={`/studies/${study.id}/form`} />
                          <button type="submit" className="rounded-md border border-[#1d7c4a] bg-[#059669] px-3 py-1 text-xs font-semibold text-white hover:bg-[#047857]">
                            Confirm Selected Session
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>
    </PageShell>
  );
}

function toStudyMeta(value: unknown): StudyMeta {
  if (!value || typeof value !== "object") return {};
  return value as StudyMeta;
}

function toCriteria(value: unknown): {
  questions: string[];
  sampleSetups: Array<{ description: string; ingredient: string; allergen: string }>;
} {
  if (!value || typeof value !== "object") {
    return { questions: [], sampleSetups: [] };
  }

  const record = value as {
    questions?: unknown;
    sampleSetups?: unknown;
  };

  const questions = Array.isArray(record.questions)
    ? record.questions.filter((item): item is string => typeof item === "string")
    : [];

  const sampleSetups = Array.isArray(record.sampleSetups)
    ? record.sampleSetups.reduce<Array<{ description: string; ingredient: string; allergen: string }>>(
        (accumulator, item) => {
          if (!item || typeof item !== "object") {
            return accumulator;
          }

          const row = item as { description?: unknown; ingredient?: unknown; allergen?: unknown };
          if (typeof row.description !== "string" || typeof row.allergen !== "string") {
            return accumulator;
          }

          accumulator.push({
            description: row.description,
            ingredient: typeof row.ingredient === "string" ? row.ingredient : "",
            allergen: row.allergen,
          });
          return accumulator;
        },
        []
      )
    : [];

  return { questions, sampleSetups };
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
      <p className="text-xs uppercase tracking-wide text-[#64748b]">{label}</p>
      <p className="mt-1 font-medium text-[#0f172a]">{value}</p>
    </div>
  );
}

function humanize(value: string) {
  return value.replace(/_/g, " ");
}

function buildSampleCodes(studyId: string, count: number) {
  const base = studyId
    .split("")
    .reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);
  return Array.from({ length: count }, (_, index) => String((base + (index + 1) * 173) % 900 + 100));
}

function parseJarOptions(value: unknown) {
  if (!value || typeof value !== "object") {
    return { low: "Too Low", mid: "Just About Right", high: "Too High" };
  }

  const options = value as { low?: unknown; mid?: unknown; high?: unknown };
  return {
    low: typeof options.low === "string" ? options.low : "Too Low",
    mid: typeof options.mid === "string" ? options.mid : "Just About Right",
    high: typeof options.high === "string" ? options.high : "Too High",
  };
}

