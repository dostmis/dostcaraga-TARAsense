"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { clearGuestSessionCookies, getCurrentGuestSession, getCurrentSession } from "@/lib/auth/session";
import { notifyUser } from "@/lib/notifications";
import {
  ensureParticipantAssignment,
  formatPanelistNumber,
  parseOfferedSessions,
} from "@/lib/participant-assignment";
import {
  formatSessionWindow,
  normalizeDateValue,
  parseStudySessionSchedule,
} from "@/lib/study-schedule";
import { lockStudyRow, runSerializableTransaction } from "@/lib/db-transaction";
import { doesPanelistMatchTargetConsumer } from "@/lib/target-consumer";

export async function participateInStudy(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || (session.role !== "CONSUMER" && session.role !== "MSME")) {
    redirect("/login?error=Please+login+as+consumer+or+MSME+to+participate");
  }

  const defaultDashboardPath = session.role === "MSME" ? "/msme/dashboard?view=evaluate" : "/consumer/dashboard?view=available";
  const studyId = String(formData.get("studyId") ?? "").trim();
  const sessionSlotId = String(formData.get("sessionSlotId") ?? "").trim();
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? defaultDashboardPath), defaultDashboardPath);
  if (!studyId) {
    redirect(withFeedback(defaultDashboardPath, "error", "Study ID is required"));
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      status: true,
      creatorId: true,
      creator: { select: { role: true } },
      targetDemographics: true,
      sensoryAttributes: { select: { id: true }, take: 1 },
    },
  });

  if (!study) {
    redirect(withFeedback(defaultDashboardPath, "error", "Study not found"));
  }
  if (session.role === "MSME" && study.creatorId === session.userId) {
    redirect("/msme/dashboard?error=MSME+users+cannot+evaluate+their+own+studies");
  }
  if (session.role === "MSME" && study.creator.role !== "MSME") {
    redirect("/msme/dashboard?view=evaluate&error=MSME+users+can+only+evaluate+other+MSME+studies");
  }
  if (!["RECRUITING", "ACTIVE"].includes(study.status)) {
    redirect(withFeedback(defaultDashboardPath, "error", "Study is not open for participation"));
  }
  if (study.sensoryAttributes.length === 0) {
    redirect(withFeedback(defaultDashboardPath, "error", "Study has no questionnaire yet"));
  }

  const panelist = await ensurePanelistForUser(session.userId);
  if (!doesPanelistMatchTargetConsumer(panelist, study.targetDemographics)) {
    redirect(withFeedback(defaultDashboardPath, "error", "Your panelist profile does not match this study"));
  }
  const isSelfManagedPublic = getStudyCoordinationMode(study.targetDemographics) === "SELF_MANAGED_PUBLIC";
  const schedule = isSelfManagedPublic ? null : parseStudySessionSchedule(study.targetDemographics);
  const selectedSlot =
    schedule && schedule.slots.length > 0
      ? schedule.slots.find((slot) => slot.id === sessionSlotId) ?? null
      : null;

  if (schedule && schedule.slots.length > 0 && !selectedSlot) {
    redirect(withFeedback(defaultDashboardPath, "error", "Please select an available session before participating"));
  }

  const transactionResult = await runSerializableTransaction(async (tx) => {
    await lockStudyRow(tx, study.id);

    const existing = await tx.studyParticipant.findFirst({
      where: {
        studyId: study.id,
        panelistId: panelist.id,
        status: { not: "CANCELLED" },
      },
      select: { id: true, status: true },
    });

    if (existing) {
      return {
        type: "existing" as const,
        participantId: existing.id,
        status: existing.status,
      };
    }

    let selectedStartIso: string | null = null;
    if (selectedSlot) {
      selectedStartIso = normalizeDateValue(selectedSlot.startsAt);
      if (!selectedStartIso) {
        return { type: "invalid-session" as const };
      }

      const selectedStartDate = new Date(selectedStartIso);
      const occupiedCount = await tx.studyParticipant.count({
        where: {
          studyId: study.id,
          status: { notIn: ["CANCELLED", "DECLINED"] },
          OR: [
            { requestedSessionAt: selectedStartDate },
            { sessionAt: selectedStartDate },
          ],
        },
      });

      if (occupiedCount >= selectedSlot.capacity) {
        return { type: "session-full" as const };
      }
    }

    const lastOrder = await tx.studyParticipant.findFirst({
      where: { studyId: study.id },
      orderBy: { selectionOrder: "desc" },
      select: { selectionOrder: true },
    });

    const selectedStartDate = selectedStartIso ? new Date(selectedStartIso) : null;
    const isImmediatePublicRecruitment = isSelfManagedPublic && !selectedSlot;
    const created = await tx.studyParticipant.create({
      data: {
        studyId: study.id,
        panelistId: panelist.id,
        status: selectedSlot || isImmediatePublicRecruitment ? "SELECTED" : "WAITLIST",
        selectionOrder: (lastOrder?.selectionOrder ?? 0) + 1,
        applicationAt: new Date(),
        offeredSessions: selectedSlot ? [selectedSlot.startsAt] : undefined,
        requestedSessionAt: selectedStartDate,
        sessionAt: selectedStartDate,
        invitationSent: selectedSlot || isImmediatePublicRecruitment ? new Date() : null,
        confirmedAt: selectedSlot || isImmediatePublicRecruitment ? new Date() : null,
      },
      select: {
        id: true,
        panelistNumber: true,
        randomizeCode: true,
        sampleCodes: true,
      },
    });

    const assigned = await ensureParticipantAssignment(tx, {
      participantId: created.id,
      studyId: study.id,
      panelistNumber: created.panelistNumber,
      randomizeCode: created.randomizeCode,
      sampleCodes: created.sampleCodes,
    });

    return {
      type: "created" as const,
      participantId: created.id,
      assignment: assigned,
    };
  }, { label: "participateInStudy" });

  if (transactionResult.type === "existing") {
    if (transactionResult.status === "COMPLETED") {
      redirect(withFeedback(defaultDashboardPath, "message", "You already completed this study"));
    }
    if (redirectTo.startsWith(`/studies/${study.id}/start`)) {
      redirect(withFeedback(withParticipantVerification(redirectTo, transactionResult.participantId), "message", "Participation already submitted"));
    }
    redirect(withFeedback(defaultDashboardPath, "message", "Participation already submitted"));
  }
  if (transactionResult.type === "invalid-session") {
    redirect(withFeedback(defaultDashboardPath, "error", "The selected session is invalid"));
  }
  if (transactionResult.type === "session-full") {
    redirect(withFeedback(defaultDashboardPath, "error", "That session is already full. Please choose another slot"));
  }

  const sessionSummary = selectedSlot
    ? formatSessionWindow(selectedSlot, schedule?.timezone ?? "Asia/Manila")
    : "No fixed schedule selected yet";

  const evaluatorLabel = session.role === "MSME" ? "MSME evaluator" : "consumer";
  await notifyUser(study.creatorId, {
    title: selectedSlot ? `New ${evaluatorLabel} booked a session` : `New ${evaluatorLabel} volunteer`,
    message: selectedSlot
      ? `A ${evaluatorLabel} booked: ${sessionSummary}. Panelist No: ${formatPanelistNumber(transactionResult.assignment.panelistNumber)}.`
      : `A ${evaluatorLabel} volunteered for your study and is awaiting qualification.`,
    level: "INFO",
    category: "SURVEY",
    actionUrl: `/studies/${study.id}/form`,
    metadata: {
      studyId: study.id,
      selectedSession: selectedSlot?.startsAt ?? null,
      panelistNumber: transactionResult.assignment.panelistNumber,
      sampleCodes: transactionResult.assignment.sampleCodes,
    },
  });

  revalidatePath("/consumer/dashboard");
  revalidatePath("/msme/dashboard");
  revalidatePath(`/studies/${study.id}/form`);

  if (selectedSlot) {
    if (redirectTo.startsWith(`/studies/${study.id}/start`)) {
      redirect(withFeedback(withParticipantVerification(redirectTo, transactionResult.participantId), "message", "Session booked successfully"));
    }
    redirect(withFeedback(defaultDashboardPath, "message", "Session booked successfully"));
  }
  if (redirectTo.startsWith(`/studies/${study.id}/start`)) {
    const message = isSelfManagedPublic
      ? "Registration complete. Please review the consent form before evaluation"
      : "Participation submitted. Wait for MSME qualification";
    redirect(withFeedback(withParticipantVerification(redirectTo, transactionResult.participantId), "message", message));
  }
  redirect(withFeedback(defaultDashboardPath, "message", "Participation submitted. Wait for MSME qualification"));
}

export async function offerScheduleOptions(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || (session.role !== "MSME" && session.role !== "ADMIN")) {
    redirect("/login?error=MSME+login+required");
  }

  const studyId = String(formData.get("studyId") ?? "").trim();
  const participantId = String(formData.get("participantId") ?? "").trim();
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? `/studies/${studyId}/form`));
  const offered = [
    String(formData.get("option1") ?? "").trim(),
    String(formData.get("option2") ?? "").trim(),
    String(formData.get("option3") ?? "").trim(),
  ]
    .filter(Boolean)
    .map((value) => parseDateTime(value))
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.toISOString());

  const offeredSessions = Array.from(new Set(offered)).sort();

  if (!studyId || !participantId || offeredSessions.length === 0) {
    redirect(withFeedback(redirectTo, "error", "Provide+at+least+one+valid+session+option"));
  }

  const participant = await prisma.studyParticipant.findFirst({
    where: { id: participantId, studyId },
    select: {
      id: true,
      panelistNumber: true,
      randomizeCode: true,
      sampleCodes: true,
      panelist: {
        select: {
          userId: true,
          name: true,
        },
      },
      study: {
        select: {
          id: true,
          title: true,
          creatorId: true,
        },
      },
    },
  });

  if (!participant) {
    redirect(withFeedback(redirectTo, "error", "Participant+record+not+found"));
  }
  if (session.role === "MSME" && participant.study.creatorId !== session.userId) {
    redirect(withFeedback(redirectTo, "error", "Unauthorized+study+access"));
  }

  const assigned = await ensureParticipantAssignment(prisma, {
    participantId: participant.id,
    studyId,
    panelistNumber: participant.panelistNumber,
    randomizeCode: participant.randomizeCode,
    sampleCodes: participant.sampleCodes,
  });

  await prisma.studyParticipant.update({
    where: { id: participant.id },
    data: {
      status: "SELECTED",
      invitationSent: new Date(),
      offeredSessions: offeredSessions,
      requestedSessionAt: null,
      sessionAt: null,
      confirmedAt: null,
      reminderSentAt: null,
    },
  });

  if (participant.panelist.userId) {
    await notifyUser(participant.panelist.userId, {
      title: "Choose your session schedule",
      message: `You are qualified for "${participant.study.title}". Panelist No: ${formatPanelistNumber(assigned.panelistNumber)}. Select your preferred session date and time.`,
      level: "SUCCESS",
      category: "SURVEY",
      actionUrl: "/consumer/dashboard?view=available",
      metadata: {
        studyId,
        participantId: participant.id,
        panelistNumber: assigned.panelistNumber,
        sampleCodes: assigned.sampleCodes,
        offeredSessions,
      },
    });
  }

  revalidatePath(redirectTo.split("?")[0] || redirectTo);
  revalidatePath("/consumer/dashboard");
  redirect(withFeedback(redirectTo, "message", "Schedule+options+sent+to+consumer"));
}

export async function chooseSessionOption(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || session.role !== "CONSUMER") {
    redirect("/login?error=Consumer+login+required");
  }

  const studyId = String(formData.get("studyId") ?? "").trim();
  const participantId = String(formData.get("participantId") ?? "").trim();
  const chosen = String(formData.get("sessionChoice") ?? "").trim();

  if (!studyId || !participantId || !chosen) {
    redirect("/consumer/dashboard?view=available&error=Select+a+valid+session+option");
  }

  const participant = await prisma.studyParticipant.findFirst({
    where: { id: participantId, studyId },
    select: {
      id: true,
      offeredSessions: true,
      panelist: { select: { userId: true } },
      study: { select: { creatorId: true, title: true } },
    },
  });

  if (!participant || participant.panelist.userId !== session.userId) {
    redirect("/consumer/dashboard?view=available&error=Participant+slot+not+found");
  }

  const offeredSessions = parseOfferedSessions(participant.offeredSessions);
  if (!offeredSessions.includes(chosen)) {
    redirect("/consumer/dashboard?view=available&error=Selected+session+is+not+in+the+offered+options");
  }

  const chosenDate = new Date(chosen);
  await prisma.studyParticipant.update({
    where: { id: participant.id },
    data: {
      requestedSessionAt: chosenDate,
    },
  });

  await notifyUser(participant.study.creatorId, {
    title: "Consumer selected a session",
    message: `A participant selected ${chosenDate.toLocaleString()} for "${participant.study.title}".`,
    level: "INFO",
    category: "SURVEY",
    actionUrl: `/studies/${studyId}/form`,
    metadata: {
      studyId,
      participantId: participant.id,
      requestedSessionAt: chosenDate.toISOString(),
    },
  });

  revalidatePath("/consumer/dashboard");
  revalidatePath(`/studies/${studyId}/form`);
  redirect("/consumer/dashboard?view=available&message=Session+choice+submitted.+Await+MSME+confirmation");
}

export async function confirmParticipantSession(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || (session.role !== "MSME" && session.role !== "ADMIN")) {
    redirect("/login?error=MSME+login+required");
  }

  const studyId = String(formData.get("studyId") ?? "").trim();
  const participantId = String(formData.get("participantId") ?? "").trim();
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? `/studies/${studyId}/form`));
  if (!studyId || !participantId) {
    redirect(withFeedback(redirectTo, "error", "Missing+participant+or+study+details"));
  }

  const participant = await prisma.studyParticipant.findFirst({
    where: { id: participantId, studyId },
    select: {
      id: true,
      panelistNumber: true,
      requestedSessionAt: true,
      panelist: {
        select: {
          userId: true,
        },
      },
      study: {
        select: {
          id: true,
          title: true,
          creatorId: true,
          productName: true,
          category: true,
          location: true,
          targetDemographics: true,
        },
      },
    },
  });

  if (!participant) {
    redirect(withFeedback(redirectTo, "error", "Participant+record+not+found"));
  }
  if (session.role === "MSME" && participant.study.creatorId !== session.userId) {
    redirect(withFeedback(redirectTo, "error", "Unauthorized+study+access"));
  }
  if (!participant.requestedSessionAt) {
    redirect(withFeedback(redirectTo, "error", "Consumer+has+not+selected+a+session+yet"));
  }

  const confirmedSessionResult = await runSerializableTransaction(async (tx) => {
    await lockStudyRow(tx, studyId);

    const latestParticipant = await tx.studyParticipant.findFirst({
      where: { id: participant.id, studyId },
      select: {
        id: true,
        requestedSessionAt: true,
        study: {
          select: {
            targetDemographics: true,
          },
        },
      },
    });

    if (!latestParticipant?.requestedSessionAt) {
      return { ok: false as const, reason: "missing-requested" as const };
    }

    const requestedIso = normalizeDateValue(latestParticipant.requestedSessionAt);
    if (!requestedIso) {
      return { ok: false as const, reason: "invalid-requested" as const };
    }

    const sessionSchedule = parseStudySessionSchedule(latestParticipant.study.targetDemographics);
    const targetSlot = sessionSchedule?.slots.find((slot) => normalizeDateValue(slot.startsAt) === requestedIso);

    if (targetSlot) {
      const requestedSessionAt = new Date(requestedIso);
      const occupiedCount = await tx.studyParticipant.count({
        where: {
          studyId,
          id: { not: participant.id },
          status: { notIn: ["CANCELLED", "DECLINED"] },
          OR: [{ requestedSessionAt }, { sessionAt: requestedSessionAt }],
        },
      });

      if (occupiedCount >= targetSlot.capacity) {
        return { ok: false as const, reason: "session-full" as const };
      }
    }

    await tx.studyParticipant.update({
      where: { id: participant.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        sessionAt: latestParticipant.requestedSessionAt,
        reminderSentAt: null,
      },
    });

    return { ok: true as const };
  }, { label: "confirmParticipantSession" });

  if (!confirmedSessionResult.ok) {
    if (confirmedSessionResult.reason === "session-full") {
      redirect(withFeedback(redirectTo, "error", "Selected+session+is+already+full.+Please+send+new+options"));
    }
    redirect(withFeedback(redirectTo, "error", "Consumer+session+selection+is+no+longer+valid"));
  }

  if (participant.panelist.userId) {
    const noOfSamples = getNoOfSamples(participant.study.targetDemographics);
    await notifyUser(participant.panelist.userId, {
      title: "Session confirmed by MSME",
      message: [
        `Product/Study Type: ${participant.study.productName}`,
        `Category: ${participant.study.category}`,
        `Facility: ${participant.study.location}`,
        `No. of Samples: ${noOfSamples}`,
        `Time and Date: ${participant.requestedSessionAt.toLocaleString()}`,
        `Panelist Number: ${formatPanelistNumber(participant.panelistNumber)}`,
      ].join(" | "),
      level: "SUCCESS",
      category: "SURVEY",
      actionUrl: `/studies/${studyId}/start`,
      metadata: {
        studyId,
        participantId: participant.id,
        panelistNumber: participant.panelistNumber,
        sessionAt: participant.requestedSessionAt.toISOString(),
      },
    });
  }

  revalidatePath("/consumer/dashboard");
  revalidatePath(redirectTo.split("?")[0] || redirectTo);
  redirect(withFeedback(redirectTo, "message", "Participant+session+confirmed"));
}

export async function verifyPanelistNumber(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || session.role !== "CONSUMER") {
    redirect("/login?error=Consumer+login+required");
  }

  const studyId = String(formData.get("studyId") ?? "").trim();
  const panelistNumberInput = String(formData.get("panelistNumber") ?? "").trim();
  const panelistNumber = Number(panelistNumberInput);
  if (!studyId || !Number.isInteger(panelistNumber) || panelistNumber <= 0) {
    redirect(`/studies/${studyId}/start?error=Enter+a+valid+Panelist+Number`);
  }

  const panelist = await ensurePanelistForUser(session.userId);
  const participant = await prisma.studyParticipant.findFirst({
    where: {
      studyId,
      panelistId: panelist.id,
      panelistNumber,
      status: { in: ["SELECTED", "CONFIRMED"] },
    },
    select: { id: true },
  });

  if (!participant) {
    redirect(`/studies/${studyId}/start?error=Panelist+Number+not+matched+to+your+account`);
  }

  redirect(`/studies/${studyId}/start?participantId=${participant.id}&verified=1`);
}

export async function submitStudyConsent(formData: FormData) {
  const session = await getCurrentSession();
  const studyId = String(formData.get("studyId") ?? "").trim();
  const guestSession = await getCurrentGuestSession();
  const isConsumer = session?.role === "CONSUMER";
  const isMsme = session?.role === "MSME";
  const isGuest = !session && guestSession?.studyId === studyId;

  if (!isConsumer && !isMsme && !isGuest) {
    redirect("/login?error=Consumer+or+MSME+login+required");
  }

  const participantId = String(formData.get("participantId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").toUpperCase();
  if (!studyId || !participantId || (decision !== "AGREE" && decision !== "DECLINE")) {
    redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&error=Select+a+consent+decision`);
  }

  const participant = await prisma.studyParticipant.findFirst({
    where: { id: participantId, studyId },
    select: {
      id: true,
      panelist: {
        select: {
          userId: true,
        },
      },
      source: true,
      requestedSessionAt: true,
      sessionAt: true,
      study: {
        select: {
          creatorId: true,
          creator: { select: { role: true } },
          title: true,
          targetDemographics: true,
        },
      },
    },
  });

  if (!participant) {
    if (isGuest) {
      redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&error=Participant+slot+not+found`);
    }
    redirect(withFeedback(session ? ROLE_DASHBOARD_PATH[session.role] : "/consumer/dashboard?view=available", "error", "Participant slot not found"));
  }
  if (isConsumer && participant.panelist.userId !== session?.userId) {
    redirect("/consumer/dashboard?view=available&error=Participant+slot+not+found");
  }
  if (isMsme && participant.study.creatorId === session?.userId) {
    redirect("/msme/dashboard?error=MSME+users+cannot+evaluate+their+own+studies");
  }
  if (isMsme && participant.study.creator.role !== "MSME") {
    redirect("/msme/dashboard?view=evaluate&error=MSME+users+can+only+evaluate+other+MSME+studies");
  }
  if (isMsme && participant.panelist.userId !== session?.userId) {
    redirect("/msme/dashboard?view=evaluate&error=Participant+slot+not+found");
  }
  if (isGuest && (!guestSession || participant.source !== "WALK_IN_GUEST" || participant.id !== guestSession.participantId)) {
    redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&error=Guest+session+is+invalid`);
  }
  const isScheduledAuthenticatedCheckIn =
    (isConsumer || isMsme) &&
    getStudyCoordinationMode(participant.study.targetDemographics) !== "SELF_MANAGED_PUBLIC" &&
    Boolean(parseStudySessionSchedule(participant.study.targetDemographics));
  if (isScheduledAuthenticatedCheckIn) {
    const schedule = parseStudySessionSchedule(participant.study.targetDemographics);
    const sessionSlot = findParticipantSessionSlot(participant.sessionAt ?? participant.requestedSessionAt, schedule);
    const sessionState = sessionSlot ? getSessionEvaluationState(sessionSlot) : "UNKNOWN";

    if (sessionState !== "ACTIVE") {
      const error =
        sessionState === "UPCOMING"
          ? "Evaluation+will+open+when+your+assigned+session+starts"
          : sessionState === "ENDED"
            ? "Your+assigned+session+has+ended.+Please+ask+the+facilitator+for+a+new+testing+slot"
            : "Assigned+session+could+not+be+confirmed";
      redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&error=${error}`);
    }
  }

  if (decision === "DECLINE") {
    await prisma.studyParticipant.update({
      where: { id: participant.id },
      data: {
        consentStatus: "DECLINED",
        declinedAt: new Date(),
        status: "DECLINED",
      },
    });

    await notifyUser(participant.study.creatorId, {
      title: "Consumer declined consent",
      message: `A participant declined consent for "${participant.study.title}".`,
      level: "WARNING",
      category: "SURVEY",
      actionUrl: `/studies/${studyId}/form`,
      metadata: { studyId, participantId: participant.id },
    });

    revalidatePath("/consumer/dashboard");
    revalidatePath("/msme/dashboard");
    revalidatePath(`/studies/${studyId}/form`);
    if (isGuest) {
      const store = await cookies();
      clearGuestSessionCookies(store);
      redirect(`/test/completed?studyId=${studyId}`);
    }
    redirect(
      isMsme
        ? "/msme/dashboard?view=evaluate&message=Consent+declined.+You+will+not+proceed+to+evaluation"
        : "/consumer/dashboard?view=available&message=Consent+declined.+You+will+not+proceed+to+evaluation"
    );
  }

  await prisma.studyParticipant.update({
    where: { id: participant.id },
    data: {
      consentStatus: "AGREED",
      consentedAt: new Date(),
      status: "CONFIRMED",
    },
  });

  revalidatePath(`/studies/${studyId}/start`);
  redirect(`/test/${studyId}/${participant.id}`);
}

async function ensurePanelistForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    redirect("/login?error=Session+expired");
  }

  const panelistSelect = {
    id: true,
    userId: true,
    age: true,
    gender: true,
    lifestyle: true,
    dietaryPrefs: true,
    consumptionHabits: true,
    isActive: true,
  } as const;

  let panelist = await prisma.panelist.findFirst({
    where: {
      OR: [{ userId: user.id }, { email: user.email }],
    },
    select: panelistSelect,
  });

  if (!panelist) {
    panelist = await prisma.panelist.create({
      data: {
        userId: user.id,
        name: user.name,
        email: user.email,
        age: 25,
        gender: "PREFER_NOT_SAY",
        location: "Unspecified",
        occupation: "Consumer",
        lifestyle: ["general"],
        dietaryPrefs: [],
        consumptionHabits: { snacks: "weekly" },
        isActive: true,
      },
      select: panelistSelect,
    });
  } else if (!panelist.userId) {
    panelist = await prisma.panelist.update({
      where: { id: panelist.id },
      data: { userId: user.id },
      select: panelistSelect,
    });
  }

  return panelist;
}

function parseDateTime(raw: string) {
  if (!raw) return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return value;
}

function withFeedback(pathname: string, key: "error" | "message", value: string) {
  const target = new URL(pathname, "http://localhost");
  target.searchParams.set(key, value.replace(/\+/g, " "));
  return `${target.pathname}${target.search}`;
}

function withParticipantVerification(pathname: string, participantId: string) {
  const target = new URL(pathname, "http://localhost");
  target.searchParams.set("participantId", participantId);
  target.searchParams.set("verified", "1");
  return `${target.pathname}${target.search}`;
}

function safeRedirect(raw: string, fallback = "/consumer/dashboard?view=available") {
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return fallback;
}

function getNoOfSamples(value: unknown) {
  if (!value || typeof value !== "object") {
    return 1;
  }
  const row = value as { numberOfSamples?: unknown };
  if (typeof row.numberOfSamples !== "number" || row.numberOfSamples < 1) {
    return 1;
  }
  return Math.floor(row.numberOfSamples);
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
