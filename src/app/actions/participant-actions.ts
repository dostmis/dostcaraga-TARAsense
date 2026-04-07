"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
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

export async function participateInStudy(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || session.role !== "CONSUMER") {
    redirect("/login?error=Please+login+as+consumer+to+participate");
  }

  const studyId = String(formData.get("studyId") ?? "").trim();
  const sessionSlotId = String(formData.get("sessionSlotId") ?? "").trim();
  if (!studyId) {
    redirect("/consumer/dashboard?view=available&error=Study+ID+is+required");
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      status: true,
      creatorId: true,
      targetDemographics: true,
      sensoryAttributes: { select: { id: true }, take: 1 },
    },
  });

  if (!study) {
    redirect("/consumer/dashboard?view=available&error=Study+not+found");
  }
  if (!["RECRUITING", "ACTIVE"].includes(study.status)) {
    redirect("/consumer/dashboard?view=available&error=Study+is+not+open+for+participation");
  }
  if (study.sensoryAttributes.length === 0) {
    redirect("/consumer/dashboard?view=available&error=Study+has+no+questionnaire+yet");
  }

  const panelist = await ensurePanelistForUser(session.userId);
  const schedule = parseStudySessionSchedule(study.targetDemographics);
  const selectedSlot =
    schedule && schedule.slots.length > 0
      ? schedule.slots.find((slot) => slot.id === sessionSlotId) ?? null
      : null;

  if (schedule && schedule.slots.length > 0 && !selectedSlot) {
    redirect("/consumer/dashboard?view=available&error=Please+select+an+available+session+before+participating");
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
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
    const created = await tx.studyParticipant.create({
      data: {
        studyId: study.id,
        panelistId: panelist.id,
        status: selectedSlot ? "SELECTED" : "WAITLIST",
        selectionOrder: (lastOrder?.selectionOrder ?? 0) + 1,
        applicationAt: new Date(),
        offeredSessions: selectedSlot ? [selectedSlot.startsAt] : undefined,
        requestedSessionAt: selectedStartDate,
        sessionAt: selectedStartDate,
        invitationSent: selectedSlot ? new Date() : null,
        confirmedAt: selectedSlot ? new Date() : null,
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
      assignment: assigned,
    };
  });

  if (transactionResult.type === "existing") {
    if (transactionResult.status === "COMPLETED") {
      redirect("/consumer/dashboard?view=available&message=You+already+completed+this+study");
    }
    redirect("/consumer/dashboard?view=available&message=Participation+already+submitted");
  }
  if (transactionResult.type === "invalid-session") {
    redirect("/consumer/dashboard?view=available&error=The+selected+session+is+invalid");
  }
  if (transactionResult.type === "session-full") {
    redirect("/consumer/dashboard?view=available&error=That+session+is+already+full.+Please+choose+another+slot");
  }

  const sessionSummary = selectedSlot
    ? formatSessionWindow(selectedSlot, schedule?.timezone ?? "Asia/Manila")
    : "No fixed schedule selected yet";

  await notifyUser(study.creatorId, {
    title: selectedSlot ? "New consumer booked a session" : "New consumer volunteer",
    message: selectedSlot
      ? `A consumer booked: ${sessionSummary}. Panelist No: ${formatPanelistNumber(transactionResult.assignment.panelistNumber)}.`
      : "A consumer volunteered for your study and is awaiting qualification.",
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
  revalidatePath(`/studies/${study.id}/form`);

  if (selectedSlot) {
    redirect("/consumer/dashboard?view=available&message=Session+booked+successfully");
  }
  redirect("/consumer/dashboard?view=available&message=Participation+submitted.+Wait+for+MSME+qualification");
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

  await prisma.studyParticipant.update({
    where: { id: participant.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      sessionAt: participant.requestedSessionAt,
      reminderSentAt: null,
    },
  });

  if (participant.panelist.userId) {
    const noOfSamples = getNoOfSamples(participant.study.targetDemographics);
    await notifyUser(participant.panelist.userId, {
      title: "Session confirmed by MSME",
      message: [
        `Product/Study Type: ${participant.study.productName}`,
        `Category: ${participant.study.category}`,
        `Facility Type: ${participant.study.location}`,
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
  const isGuest = !session && guestSession?.studyId === studyId;

  if (!isConsumer && !isGuest) {
    redirect("/login?error=Consumer+login+required");
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
      study: {
        select: {
          creatorId: true,
          title: true,
        },
      },
    },
  });

  if (!participant) {
    if (isGuest) {
      redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&error=Participant+slot+not+found`);
    }
    redirect("/consumer/dashboard?view=available&error=Participant+slot+not+found");
  }
  if (isConsumer && participant.panelist.userId !== session?.userId) {
    redirect("/consumer/dashboard?view=available&error=Participant+slot+not+found");
  }
  if (isGuest && (!guestSession || participant.source !== "WALK_IN_GUEST" || participant.id !== guestSession.participantId)) {
    redirect(`/studies/${studyId}/start?participantId=${participantId}&verified=1&error=Guest+session+is+invalid`);
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
    revalidatePath(`/studies/${studyId}/form`);
    if (isGuest) {
      const store = await cookies();
      clearGuestSessionCookies(store);
      redirect(`/test/completed?studyId=${studyId}`);
    }
    redirect("/consumer/dashboard?view=available&message=Consent+declined.+You+will+not+proceed+to+evaluation");
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

  let panelist = await prisma.panelist.findFirst({
    where: {
      OR: [{ userId: user.id }, { email: user.email }],
    },
    select: { id: true, userId: true },
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
      select: { id: true, userId: true },
    });
  } else if (!panelist.userId) {
    panelist = await prisma.panelist.update({
      where: { id: panelist.id },
      data: { userId: user.id },
      select: { id: true, userId: true },
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
  const divider = pathname.includes("?") ? "&" : "?";
  return `${pathname}${divider}${key}=${value}`;
}

function safeRedirect(raw: string) {
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/consumer/dashboard?view=available";
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
