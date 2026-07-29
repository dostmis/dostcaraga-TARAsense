import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { getCurrentGuestSession, getCurrentSession } from "@/lib/auth/session";
import { participateInStudy, submitStudyConsent } from "@/app/actions/participant-actions";
import { formatPanelistNumber, parseSampleCodes } from "@/lib/participant-assignment";
import { doesPanelistMatchTargetConsumer } from "@/lib/target-consumer";
import { formatSessionWindow, normalizeDateValue, parseStudySessionSchedule } from "@/lib/study-schedule";

type PageProps = {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<{ error?: string; message?: string; participantId?: string; verified?: string; slotId?: string }>;
};

export default async function StartStudyPage({ params, searchParams }: PageProps) {
  const { studyId } = await params;
  const query = await searchParams;
  const slotIdFromQuery = typeof query.slotId === "string" ? query.slotId.trim() : "";
  const nextPath = slotIdFromQuery
    ? `/studies/${studyId}/start?slotId=${encodeURIComponent(slotIdFromQuery)}`
    : `/studies/${studyId}/start`;
  const session = await getCurrentSession();
  const guestSession = await getCurrentGuestSession();
  const isGuest = !session && guestSession?.studyId === studyId;

  const error = query.error ? decodeURIComponent(query.error) : undefined;
  const message = query.message ? decodeURIComponent(query.message) : undefined;
  const participantIdFromQuery = typeof query.participantId === "string" ? query.participantId : "";
  const participantId = participantIdFromQuery || (isGuest ? guestSession?.participantId ?? "" : "");

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      productName: true,
      status: true,
      creatorId: true,
      creator: { select: { role: true } },
      targetDemographics: true,
      sensoryAttributes: { select: { id: true }, take: 1 },
    },
  });

  if (!study) {
    notFound();
  }
  const isConsumer = session?.role === "CONSUMER";
  const isMSMEPeerEvaluator =
    session?.role === "MSME" &&
    study.creatorId !== session.userId &&
    study.creator.role === "MSME";
  const isAuthenticatedEvaluator = isConsumer || isMSMEPeerEvaluator;

  if (session?.role === "MSME" && study.creatorId === session.userId) {
    redirect("/msme/dashboard?error=MSME+users+cannot+evaluate+their+own+studies");
  }
  if (session && !isAuthenticatedEvaluator) {
    redirect(ROLE_DASHBOARD_PATH[session.role]);
  }
  if (!isAuthenticatedEvaluator && !isGuest) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}&message=Sign+in+to+join+this+sensory+study.+New+users+can+create+a+consumer+account+below`);
  }

  const evaluatorDashboardPath = isMSMEPeerEvaluator ? "/msme/dashboard?view=evaluate" : "/consumer/dashboard?view=available";
  if (!["RECRUITING", "ACTIVE"].includes(study.status)) {
    redirect(`${evaluatorDashboardPath}&error=This+study+is+not+open+for+responses`);
  }
  if (study.sensoryAttributes.length === 0) {
    redirect(`${evaluatorDashboardPath}&error=This+study+has+no+questionnaire+yet`);
  }

  const panelist = isAuthenticatedEvaluator
    ? await prisma.panelist.findFirst({
        where: {
          userId: session?.userId ?? "__no-user__",
        },
        select: {
          id: true,
          lifestyle: true,
          dietaryPrefs: true,
          consumptionHabits: true,
          isActive: true,
        },
      })
    : null;
  const panelistMatchesTarget = isAuthenticatedEvaluator
    ? doesPanelistMatchTargetConsumer(panelist, study.targetDemographics)
    : false;
  const sessionSchedule = parseStudySessionSchedule(study.targetDemographics);
  const isSelfManagedPublic = getStudyCoordinationMode(study.targetDemographics) === "SELF_MANAGED_PUBLIC";
  const isScheduledCheckIn = Boolean(sessionSchedule && !isSelfManagedPublic);
  const slotFromQr =
    isScheduledCheckIn && slotIdFromQuery
      ? sessionSchedule?.slots.find((slot) => slot.id === slotIdFromQuery) ?? null
      : null;
  const hasInvalidQrSlot = Boolean(isScheduledCheckIn && slotIdFromQuery && !slotFromQr);

  const participant = participantId || (isAuthenticatedEvaluator && panelist)
      ? await prisma.studyParticipant.findFirst({
          where: {
            studyId: study.id,
            status: { in: ["WAITLIST", "SELECTED", "CONFIRMED", "COMPLETED", "DECLINED"] },
            ...(isAuthenticatedEvaluator
              ? {
                  panelistId: panelist?.id ?? "__no-panelist__",
                  ...(participantId ? { id: participantId } : {}),
              }
            : {
                id: participantId,
                source: "WALK_IN_GUEST",
              }),
        },
        select: {
          id: true,
          status: true,
          panelistNumber: true,
          randomizeCode: true,
          sampleCodes: true,
          consentStatus: true,
          guestCode: true,
          source: true,
          requestedSessionAt: true,
          sessionAt: true,
        },
      })
    : null;
  const participantSessionRows =
    !participant && isAuthenticatedEvaluator && panelistMatchesTarget && isScheduledCheckIn && sessionSchedule
      ? await prisma.studyParticipant.findMany({
          where: {
            studyId: study.id,
            status: { notIn: ["CANCELLED", "DECLINED"] },
          },
          select: {
            requestedSessionAt: true,
            sessionAt: true,
          },
        })
      : [];
  const slotAvailability =
    sessionSchedule?.slots.map((slot) => {
      const slotStart = normalizeDateValue(slot.startsAt);
      const reservedCount = participantSessionRows.filter((row) => {
        const selectedStart = normalizeDateValue(row.sessionAt ?? row.requestedSessionAt);
        return selectedStart === slotStart;
      }).length;
      return {
        slot,
        reservedCount,
        remainingCount: Math.max(slot.capacity - reservedCount, 0),
      };
    }) ?? [];
  const qrSlotAvailability = slotFromQr
    ? slotAvailability.find((entry) => entry.slot.id === slotFromQr.id) ?? null
    : null;
  const hasAvailableSlot = slotAvailability.some((entry) => entry.remainingCount > 0);

  if (isGuest && participant && guestSession && participant.id !== guestSession.participantId) {
    redirect("/login?error=Guest+session+mismatch.+Please+scan+the+QR+again");
  }

  if (participant?.status === "COMPLETED") {
    redirect(`/test/completed?studyId=${study.id}`);
  }
  if (participant?.status === "DECLINED") {
    redirect(`/test/completed?studyId=${study.id}`);
  }

  const participantSessionSlot =
    participant && sessionSchedule
      ? findParticipantSessionSlot(participant.sessionAt ?? participant.requestedSessionAt, sessionSchedule)
      : null;
  const participantSessionState = participantSessionSlot
    ? getSessionEvaluationState(participantSessionSlot)
    : null;
  const canProceedToScheduledEvaluation =
    Boolean(participant && isScheduledCheckIn && participantSessionState === "ACTIVE");
  const canShowEvaluationConsent =
    Boolean(participant && participant.status !== "WAITLIST" && (!isScheduledCheckIn || canProceedToScheduledEvaluation));

  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-2xl border border-[#ea580c] bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#9a5822]">Study Access</p>
          <h1 className="mt-2 text-2xl font-bold text-[#1746ff]">{study.title}</h1>
          <p className="mt-1 text-sm text-[#64748b]">{study.productName}</p>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {message && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        </section>

        {!participant && isAuthenticatedEvaluator && (
          <section className="rounded-2xl border border-[#ea580c] bg-white p-6">
            <h2 className="text-lg font-bold text-[#1746ff]">Automated Eligibility Check</h2>
            {!panelist && (
              <>
                <p className="mt-1 text-sm text-[#64748b]">
                  Complete your TARAsense panelist matching profile before joining this sensory study.
                </p>
                <a href={isMSMEPeerEvaluator ? "/msme/dashboard?view=profile" : "/consumer/dashboard?view=profile"} className="app-button-primary mt-4 inline-flex rounded-lg px-5 py-2 text-sm">
                  Complete Profile
                </a>
              </>
            )}

            {panelist && !panelistMatchesTarget && (
              <p className="mt-1 text-sm text-[#64748b]">
                Your saved lifestyle, dietary preference, and consumption behavior profile does not match this study.
              </p>
            )}

            {panelist && panelistMatchesTarget && isScheduledCheckIn && sessionSchedule && (
              <div className="mt-3 space-y-4">
                {slotFromQr && qrSlotAvailability ? (
                  <>
                    <p className="text-sm text-[#64748b]">
                      Your TARAsense profile matches this scheduled study. Check in to secure this testing session.
                    </p>
                    <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm">
                      <p className="font-medium text-[#0f172a]">
                        {formatSessionWindow(slotFromQr, sessionSchedule.timezone)}
                      </p>
                      <p className="mt-1 text-[#64748b]">
                        Capacity: {slotFromQr.capacity} | Occupied: {qrSlotAvailability.reservedCount} | Remaining:{" "}
                        {qrSlotAvailability.remainingCount}
                      </p>
                    </div>
                    <form action={participateInStudy}>
                      <input type="hidden" name="studyId" value={study.id} />
                      <input type="hidden" name="sessionSlotId" value={slotFromQr.id} />
                      <input type="hidden" name="redirectTo" value={`/studies/${study.id}/start?slotId=${encodeURIComponent(slotFromQr.id)}`} />
                      <button
                        type="submit"
                        disabled={qrSlotAvailability.remainingCount <= 0}
                        className="app-button-primary rounded-lg px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Check In
                      </button>
                    </form>
                    {qrSlotAvailability.remainingCount <= 0 && (
                      <p className="text-xs font-medium text-[#8a5a00]">This session is already full. Please ask staff for another QR code.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[#64748b]">
                      Your TARAsense profile matches this scheduled study. Check in by choosing an available testing session.
                    </p>
                    {hasInvalidQrSlot && (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        This session QR is invalid or expired. Please ask staff for the latest QR code.
                      </p>
                    )}
                    <form action={participateInStudy} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <input type="hidden" name="studyId" value={study.id} />
                      <input type="hidden" name="redirectTo" value={`/studies/${study.id}/start`} />
                      <label className="flex-1 text-sm text-[#64748b]">
                        Session slot
                        <select
                          name="sessionSlotId"
                          className="mt-1 w-full rounded-lg border border-[#dbe3ec] px-3 py-2"
                          required
                        >
                          <option value="">Select a session</option>
                          {slotAvailability.map((entry) => (
                            <option
                              key={entry.slot.id}
                              value={entry.slot.id}
                              disabled={entry.remainingCount <= 0}
                            >
                              {formatSessionWindow(entry.slot, sessionSchedule.timezone)} ({entry.reservedCount}/
                              {entry.slot.capacity}){entry.remainingCount <= 0 ? " - FULL" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" disabled={!hasAvailableSlot} className="app-button-primary rounded-lg px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                        Check In
                      </button>
                    </form>
                    {!hasAvailableSlot && (
                      <p className="text-xs font-medium text-[#8a5a00]">All sessions are full for this study.</p>
                    )}
                  </>
                )}
              </div>
            )}

            {panelist && panelistMatchesTarget && !isScheduledCheckIn && (
              <div className="mt-3 space-y-4">
                <p className="text-sm text-[#64748b]">
                  Your TARAsense profile matches this self-managed public study. Continue to consent before starting the evaluation.
                </p>
                <form action={participateInStudy}>
                  <input type="hidden" name="studyId" value={study.id} />
                  <input type="hidden" name="redirectTo" value={`/studies/${study.id}/start`} />
                  <button type="submit" className="app-button-primary rounded-lg px-5 py-2 text-sm">
                    Continue to Consent
                  </button>
                </form>
              </div>
            )}
          </section>
        )}

        {!participant && isGuest && (
          <section className="rounded-2xl border border-[#ea580c] bg-white p-6">
            <h2 className="text-lg font-bold text-[#1746ff]">Guest access not ready</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              Your guest session could not be verified. Please rescan the walk-in QR code from the facilitator.
            </p>
          </section>
        )}

        {participant?.status === "WAITLIST" && (
          <section className="rounded-2xl border border-[#ea580c] bg-white p-6">
            <h2 className="text-lg font-bold text-[#1746ff]">Participation Submitted</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              Your profile matched this study. Please wait for the MSME team to qualify your slot and send session instructions.
            </p>
            <p className="mt-3 text-xs text-[#64748b]">
              Assigned Panelist No: {formatPanelistNumber(participant.panelistNumber)}
            </p>
          </section>
        )}

        {participant && participant.status !== "WAITLIST" && isScheduledCheckIn && !canProceedToScheduledEvaluation && (
          <section className="rounded-2xl border border-[#ea580c] bg-white p-6">
            <h2 className="text-lg font-bold text-[#1746ff]">Slot Check-In Complete</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              {participantSessionState === "UPCOMING"
                ? "Your account is checked in for this scheduled study. Evaluation will open when your assigned session starts."
                : participantSessionState === "ENDED"
                  ? "Your assigned session has ended. Please ask the facilitator if you need a new testing slot."
                  : "Your account is checked in for this scheduled study. Please ask the facilitator to confirm your testing session."}
            </p>
            <div className="mt-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm">
              <p className="font-small text-[#0f172a]">Panelist No.: {formatPanelistNumber(participant.panelistNumber)}</p>
              <p className="mt-1 text-[#64748b]">
                Slot: {formatParticipantSession(participant.sessionAt ?? participant.requestedSessionAt, sessionSchedule)}
              </p>
            </div>
          </section>
        )}

        {canShowEvaluationConsent && participant && (
          <>
            <section className="rounded-2xl border border-[#ea580c] bg-white p-6">
              <h2 className="text-lg font-bold text-[#1746ff]">Assigned Sample Randomize Codes</h2>
              <p className="mt-2 text-2xl font-bold tracking-tight text-[#0f172a]">
                Panelist No: {formatPanelistNumber(participant.panelistNumber)}
              </p>
              <p className="mt-1 text-sm text-[#64748b]">
                Use these codes to match your physical samples.
              </p>
              {participant.guestCode && (
                <p className="mt-1 text-xs font-medium text-[#ea580c]">Guest ID: {participant.guestCode}</p>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {renderSampleCodes(participant.sampleCodes, participant.randomizeCode).map((row) => (
                  <div key={`${row.servingOrder ?? row.sample}-${row.sample}-${row.code}`} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm">
                    <p className="font-medium text-[#0f172a]">Sample {row.servingOrder ?? row.sample} Code</p>
                    <p className="text-[#64748b]">Code: {row.code}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[#ea580c] bg-white p-6">
              <h2 className="text-lg font-bold text-[#1746ff]">TARAsense Sensory Evaluation Consent (Short Form)</h2>
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
  return [{ sample: 1, code: fallbackCode ?? "N/A", servingOrder: 1 }];
}

function formatParticipantSession(
  value: string | Date | null | undefined,
  schedule: ReturnType<typeof parseStudySessionSchedule>
) {
  const selected = normalizeDateValue(value);
  if (!selected) {
    return "Not selected";
  }

  const matchingSlot = schedule?.slots.find((slot) => normalizeDateValue(slot.startsAt) === selected);
  if (matchingSlot) {
    return formatSessionWindow(matchingSlot, schedule?.timezone ?? "Asia/Manila");
  }

  return new Date(selected).toLocaleString();
}

function findParticipantSessionSlot(
  value: string | Date | null | undefined,
  schedule: ReturnType<typeof parseStudySessionSchedule>
) {
  const selected = normalizeDateValue(value);
  if (!selected) {
    return null;
  }

  return schedule?.slots.find((slot) => normalizeDateValue(slot.startsAt) === selected) ?? null;
}

function getSessionEvaluationState(slot: NonNullable<ReturnType<typeof findParticipantSessionSlot>>) {
  const now = Date.now();
  const startsAt = new Date(slot.startsAt).getTime();
  const endsAt = new Date(slot.endsAt).getTime();

  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) {
    return "UNKNOWN";
  }
  if (now < startsAt) {
    return "UPCOMING";
  }
  if (now > endsAt) {
    return "ENDED";
  }
  return "ACTIVE";
}

function getStudyCoordinationMode(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const mode = (value as { coordinationMode?: unknown }).coordinationMode;
  return mode === "FIC_ASSISTED" || mode === "SELF_MANAGED_PUBLIC" ? mode : null;
}
