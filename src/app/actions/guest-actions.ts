"use server";

import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { notifyUser } from "@/lib/notifications";
import { ensureParticipantAssignment } from "@/lib/participant-assignment";
import { normalizeDateValue, parseStudySessionSchedule } from "@/lib/study-schedule";
import { applyGuestSessionCookies } from "@/lib/auth/session";

export async function registerWalkInGuest(formData: FormData) {
  const studyId = String(formData.get("studyId") ?? "").trim();
  const slotId = String(formData.get("slotId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const genderInput = String(formData.get("gender") ?? "").trim().toUpperCase();
  const age = Number(String(formData.get("age") ?? "").trim());
  const address = String(formData.get("address") ?? "").trim();
  const organization = String(formData.get("organization") ?? "").trim();
  const occupation = String(formData.get("occupation") ?? "").trim();

  if (!studyId || !slotId) {
    redirect("/?error=Invalid+walk-in+link");
  }
  if (name.length < 2) {
    redirect(withFeedback(studyId, slotId, "error", "Name+must+be+at+least+2+characters"));
  }
  if (!Number.isInteger(age) || age < 10 || age > 100) {
    redirect(withFeedback(studyId, slotId, "error", "Age+must+be+between+10+and+100"));
  }
  if (!address) {
    redirect(withFeedback(studyId, slotId, "error", "Address+is+required"));
  }
  if (!occupation) {
    redirect(withFeedback(studyId, slotId, "error", "Occupation+is+required"));
  }

  const gender = normalizeGender(genderInput);
  if (!gender) {
    redirect(withFeedback(studyId, slotId, "error", "Select+a+valid+gender"));
  }

  const result = await prisma.$transaction(async (tx) => {
    const study = await tx.study.findUnique({
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
      return { ok: false as const, error: "Study+not+found" };
    }
    if (!["RECRUITING", "ACTIVE"].includes(study.status)) {
      return { ok: false as const, error: "Study+is+not+open+for+walk-in+participation" };
    }
    if (study.sensoryAttributes.length === 0) {
      return { ok: false as const, error: "Study+questionnaire+is+not+configured+yet" };
    }

    const schedule = parseStudySessionSchedule(study.targetDemographics);
    const selectedSlot = schedule?.slots.find((slot) => slot.id === slotId) ?? null;
    if (!schedule || !selectedSlot) {
      return { ok: false as const, error: "Session+slot+not+found+or+expired" };
    }

    const selectedStartIso = normalizeDateValue(selectedSlot.startsAt);
    if (!selectedStartIso) {
      return { ok: false as const, error: "Session+slot+is+invalid" };
    }
    const selectedStartDate = new Date(selectedStartIso);

    const occupiedCount = await tx.studyParticipant.count({
      where: {
        studyId,
        status: { notIn: ["CANCELLED", "DECLINED"] },
        OR: [{ requestedSessionAt: selectedStartDate }, { sessionAt: selectedStartDate }],
      },
    });
    if (occupiedCount >= selectedSlot.capacity) {
      return { ok: false as const, error: "Selected+session+is+already+full" };
    }

    const lastOrder = await tx.studyParticipant.findFirst({
      where: { studyId },
      orderBy: { selectionOrder: "desc" },
      select: { selectionOrder: true },
    });

    const panelist = await tx.panelist.create({
      data: {
        name,
        email: buildGuestEmail(studyId),
        age,
        gender,
        location: address,
        organization: organization || null,
        occupation,
        lifestyle: ["walk-in"],
        dietaryPrefs: [],
        consumptionHabits: { source: "walk-in-qr" },
        isActive: true,
        isGuest: true,
      },
      select: { id: true },
    });

    const participant = await tx.studyParticipant.create({
      data: {
        studyId,
        panelistId: panelist.id,
        source: "WALK_IN_GUEST",
        status: "CONFIRMED",
        selectionOrder: (lastOrder?.selectionOrder ?? 0) + 1,
        applicationAt: new Date(),
        offeredSessions: [selectedSlot.startsAt],
        requestedSessionAt: selectedStartDate,
        sessionAt: selectedStartDate,
        invitationSent: new Date(),
        confirmedAt: new Date(),
      },
      select: {
        id: true,
        panelistNumber: true,
        randomizeCode: true,
        sampleCodes: true,
      },
    });

    const assigned = await ensureParticipantAssignment(tx, {
      participantId: participant.id,
      studyId,
      panelistNumber: participant.panelistNumber,
      randomizeCode: participant.randomizeCode,
      sampleCodes: participant.sampleCodes,
    });

    const guestCode = formatGuestCode(assigned.panelistNumber);
    await tx.studyParticipant.update({
      where: { id: participant.id },
      data: { guestCode },
    });

    return {
      ok: true as const,
      studyId,
      participantId: participant.id,
      creatorId: study.creatorId,
      title: study.title,
      selectedSession: selectedSlot.startsAt,
      guestCode,
    };
  });

  if (!result.ok) {
    redirect(withFeedback(studyId, slotId, "error", result.error));
  }

  const store = await cookies();
  applyGuestSessionCookies(store, {
    participantId: result.participantId,
    studyId: result.studyId,
    guestCode: result.guestCode,
    maxAge: 60 * 60 * 12,
  });

  await notifyUser(result.creatorId, {
    title: "Walk-in guest joined session",
    message: `A walk-in guest (${result.guestCode}) checked in for "${result.title}".`,
    level: "INFO",
    category: "SURVEY",
    actionUrl: `/studies/${result.studyId}/form`,
    metadata: {
      studyId: result.studyId,
      participantId: result.participantId,
      source: "WALK_IN_GUEST",
      guestCode: result.guestCode,
      selectedSession: result.selectedSession,
    },
  });

  revalidatePath(`/studies/${result.studyId}/form`);
  revalidatePath(`/studies/${result.studyId}/start`);
  redirect(`/studies/${result.studyId}/start?participantId=${result.participantId}&verified=1&guest=1`);
}

function withFeedback(studyId: string, slotId: string, key: "error" | "message", value: string) {
  return `/guest/check-in?studyId=${encodeURIComponent(studyId)}&slotId=${encodeURIComponent(slotId)}&${key}=${value}`;
}

function normalizeGender(input: string): "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_SAY" | null {
  if (input === "MALE" || input === "FEMALE" || input === "NON_BINARY" || input === "PREFER_NOT_SAY") {
    return input;
  }
  return null;
}

function buildGuestEmail(studyId: string) {
  const suffix = randomBytes(4).toString("hex");
  const stamp = Date.now().toString(36);
  const head = studyId.slice(0, 8).toLowerCase();
  return `guest-${head}-${stamp}-${suffix}@guest.tarasense.local`;
}

function formatGuestCode(panelistNumber: number | null) {
  const safeNumber = panelistNumber && panelistNumber > 0 ? panelistNumber : 0;
  return `G-${String(safeNumber).padStart(3, "0")}`;
}

