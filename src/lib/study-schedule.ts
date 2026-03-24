export const DEFAULT_STUDY_TIMEZONE = "Asia/Manila";

export type StudySessionSlot = {
  id: string;
  dayOffset: number;
  label: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
};

export type StudySessionSchedule = {
  timezone: string;
  startDate: string;
  durationDays: number;
  slots: StudySessionSlot[];
};

export function parseStudySessionSchedule(targetDemographics: unknown): StudySessionSchedule | null {
  if (!isRecord(targetDemographics)) {
    return null;
  }

  const scheduleValue = targetDemographics.sessionSchedule;
  if (!isRecord(scheduleValue)) {
    return null;
  }

  const timezone =
    typeof scheduleValue.timezone === "string" && scheduleValue.timezone.trim().length > 0
      ? scheduleValue.timezone
      : DEFAULT_STUDY_TIMEZONE;
  const startDate = typeof scheduleValue.startDate === "string" ? scheduleValue.startDate : "";
  const durationDays = typeof scheduleValue.durationDays === "number" ? Math.floor(scheduleValue.durationDays) : 0;

  if (!Array.isArray(scheduleValue.slots)) {
    return null;
  }

  const slots = scheduleValue.slots
    .reduce<StudySessionSlot[]>((accumulator, item) => {
      if (!isRecord(item)) {
        return accumulator;
      }

      const id = typeof item.id === "string" ? item.id.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const startsAt = typeof item.startsAt === "string" ? item.startsAt : "";
      const endsAt = typeof item.endsAt === "string" ? item.endsAt : "";
      const dayOffset = typeof item.dayOffset === "number" ? Math.floor(item.dayOffset) : -1;
      const capacity = typeof item.capacity === "number" ? Math.floor(item.capacity) : 0;

      const startsAtDate = new Date(startsAt);
      const endsAtDate = new Date(endsAt);

      if (!id || !label || dayOffset < 0 || capacity < 1) {
        return accumulator;
      }
      if (Number.isNaN(startsAtDate.getTime()) || Number.isNaN(endsAtDate.getTime())) {
        return accumulator;
      }
      if (endsAtDate.getTime() <= startsAtDate.getTime()) {
        return accumulator;
      }

      accumulator.push({
        id,
        dayOffset,
        label,
        startsAt: startsAtDate.toISOString(),
        endsAt: endsAtDate.toISOString(),
        capacity,
      });
      return accumulator;
    }, [])
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());

  if (slots.length === 0) {
    return null;
  }

  return {
    timezone,
    startDate,
    durationDays: Math.max(durationDays, 1),
    slots,
  };
}

export function formatSessionWindow(slot: StudySessionSlot, timezone: string, locale = "en-US") {
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return slot.label;
  }

  const dateLabel = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(startsAt);
  const startLabel = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(startsAt);
  const endLabel = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(endsAt);

  return `${dateLabel} | ${slot.label} | ${startLabel} - ${endLabel}`;
}

export function normalizeDateValue(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const resolved = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(resolved.getTime())) {
    return null;
  }
  return resolved.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
