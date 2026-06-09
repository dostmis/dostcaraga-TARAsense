import { randomUUID } from "crypto";
import { formatDateKeyInTimeZone } from "@/lib/date-time";
import { DEFAULT_STUDY_TIMEZONE } from "@/lib/study-schedule";

/**
 * Single source of truth for turning raw session-slot input (from the study
 * builder or a repost request) into a validated, normalized session schedule.
 *
 * Keeping this pure and shared guarantees that reposting a study enforces the
 * exact same scheduling rules as the original study-creation flow.
 */

export type SessionSlotInput = {
  dayOffset: number;
  testingDate?: string;
  label: string;
  startDateTime: string;
  endDateTime: string;
  capacity: number;
};

export type BuildSessionScheduleInput = {
  testingStartDate?: string;
  testingDurationDays?: number;
  sessionSlots: SessionSlotInput[];
};

export type BuiltSessionSlot = {
  id: string;
  dayOffset: number;
  testingDate: string;
  label: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
};

export type BuiltSessionSchedule = {
  timezone: string;
  startDate: string;
  durationDays: number;
  slots: BuiltSessionSlot[];
};

export function buildSessionSchedule(
  input: BuildSessionScheduleInput
): { success: true; value: BuiltSessionSchedule } | { success: false; error: string } {
  if (!input.testingStartDate) {
    return { success: false as const, error: "Testing start date is required." };
  }
  if (!input.testingDurationDays) {
    return { success: false as const, error: "Testing duration is required." };
  }
  const durationDays = input.testingDurationDays;
  if (input.sessionSlots.length === 0) {
    return { success: false as const, error: "Add at least one testing session." };
  }

  const slots = input.sessionSlots.reduce<BuiltSessionSlot[]>((accumulator, slot) => {
    if (slot.dayOffset >= durationDays) {
      return accumulator;
    }

    const testingDate = slot.testingDate ?? addDaysToDateInput(input.testingStartDate, slot.dayOffset);
    if (!testingDate) {
      return accumulator;
    }

    const startsAt = new Date(slot.startDateTime);
    const endsAt = new Date(slot.endDateTime);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return accumulator;
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      return accumulator;
    }
    if (
      formatDateKeyInTimeZone(startsAt, DEFAULT_STUDY_TIMEZONE) !== testingDate ||
      formatDateKeyInTimeZone(endsAt, DEFAULT_STUDY_TIMEZONE) !== testingDate
    ) {
      return accumulator;
    }

    accumulator.push({
      id: randomUUID(),
      dayOffset: slot.dayOffset,
      testingDate,
      label: slot.label.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity: slot.capacity,
    });
    return accumulator;
  }, []);

  if (slots.length === 0) {
    return {
      success: false as const,
      error: "All configured sessions are invalid. Check date, time, and day mapping.",
    };
  }

  const uniqueStarts = new Set(slots.map((slot) => slot.startsAt));
  if (uniqueStarts.size !== slots.length) {
    return {
      success: false as const,
      error: "Duplicate session start times are not allowed.",
    };
  }

  const scheduledDates = Array.from(new Set(slots.map((slot) => slot.testingDate)));
  if (scheduledDates.length !== durationDays) {
    return {
      success: false as const,
      error: `Select exactly ${durationDays} testing date(s) for the configured duration.`,
    };
  }

  return {
    success: true as const,
    value: {
      timezone: DEFAULT_STUDY_TIMEZONE,
      startDate: scheduledDates.sort((left, right) => left.localeCompare(right))[0] ?? input.testingStartDate,
      durationDays,
      slots: slots.sort(
        (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      ),
    },
  };
}

export function extractBookingDatesFromSchedule(slots: Array<{ testingDate: string }>) {
  return Array.from(new Set(slots.map((slot) => slot.testingDate))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function addDaysToDateInput(dateInput: string | undefined, dayOffset: number) {
  if (!dateInput) {
    return null;
  }

  const parts = dateInput.split("-");
  if (parts.length !== 3) return null;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const base = new Date(year, month, day);
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  base.setDate(base.getDate() + dayOffset);

  const resultYear = base.getFullYear();
  const resultMonth = String(base.getMonth() + 1).padStart(2, "0");
  const resultDay = String(base.getDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDay}`;
}
