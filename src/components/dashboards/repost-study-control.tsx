"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { repostStudy } from "@/app/actions/study-actions";

type SessionRow = {
  key: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
};

const MAX_DURATION_DAYS = 31;

function createRow(): SessionRow {
  return {
    key: Math.random().toString(36).slice(2),
    date: "",
    startTime: "09:00",
    endTime: "12:00",
    capacity: 10,
  };
}

function dayDiff(fromDate: string, toDate: string) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return NaN;
  }
  return Math.round((to - from) / 86_400_000);
}

export function RepostStudyControl({
  studyId,
  sampleSize,
  responsesCount,
}: {
  studyId: string;
  sampleSize: number;
  responsesCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([createRow()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const remainingNeeded = Math.max(0, sampleSize - responsesCount);

  const updateRow = (key: string, patch: Partial<SessionRow>) => {
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const handleSubmit = async () => {
    setError(null);

    if (rows.length === 0) {
      setError("Add at least one testing session.");
      return;
    }
    for (const row of rows) {
      if (!row.date || !row.startTime || !row.endTime || !Number.isFinite(row.capacity) || row.capacity < 1) {
        setError("Complete the date, start time, end time, and capacity for every session.");
        return;
      }
    }

    const distinctDates = Array.from(new Set(rows.map((row) => row.date))).sort((a, b) => a.localeCompare(b));
    const testingStartDate = distinctDates[0];
    const testingDurationDays = distinctDates.length;
    if (testingDurationDays > MAX_DURATION_DAYS) {
      setError(`Testing window cannot span more than ${MAX_DURATION_DAYS} days.`);
      return;
    }

    const sessionSlots = [];
    for (const row of rows) {
      const offset = dayDiff(testingStartDate, row.date);
      if (Number.isNaN(offset) || offset < 0) {
        setError("Session dates are invalid.");
        return;
      }
      // Mirror the study builder: build the instant from the Manila-local browser.
      const startsAt = new Date(`${row.date}T${row.startTime}:00`);
      const endsAt = new Date(`${row.date}T${row.endTime}:00`);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        setError("Each session must have an end time after its start time.");
        return;
      }
      sessionSlots.push({
        dayOffset: offset,
        testingDate: row.date,
        label: `Session ${sessionSlots.length + 1}`,
        startDateTime: startsAt.toISOString(),
        endDateTime: endsAt.toISOString(),
        capacity: Math.max(1, Math.floor(row.capacity)),
      });
    }

    const totalCapacity = sessionSlots.reduce((sum, slot) => sum + slot.capacity, 0);
    if (totalCapacity < remainingNeeded) {
      setError(`New session capacity (${totalCapacity}) is below the remaining ${remainingNeeded} responses needed.`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await repostStudy({
        studyId,
        testingStartDate,
        testingDurationDays,
        sessionSlots,
      });
      if (!result.success) {
        setError(result.error ?? "Failed to repost study.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Failed to repost study. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-[#ed7f2a] px-4 py-2 text-sm font-semibold text-[#b25a12] hover:bg-[#fff6ed]"
        >
          Repost Study
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-[#eadfd6] bg-[#fffdfb] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8c776a]">Repost for more responses</p>
      <p className="mt-1 text-xs text-[#6f5b4f]">
        {responsesCount}/{sampleSize} responses collected. Set a new testing schedule to recruit{" "}
        {remainingNeeded} more. Existing responses are kept and added to the analysis.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-1 gap-2 rounded-lg border border-[#eadfd6] bg-white p-3 sm:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto] sm:items-end"
          >
            <label className="text-xs text-[#6f5b4f]">
              Date
              <input
                type="date"
                value={row.date}
                onChange={(event) => updateRow(row.key, { date: event.target.value })}
                className="mt-1 w-full rounded-md border border-[#d8c7b8] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-[#6f5b4f]">
              Start
              <input
                type="time"
                value={row.startTime}
                onChange={(event) => updateRow(row.key, { startTime: event.target.value })}
                className="mt-1 w-full rounded-md border border-[#d8c7b8] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-[#6f5b4f]">
              End
              <input
                type="time"
                value={row.endTime}
                onChange={(event) => updateRow(row.key, { endTime: event.target.value })}
                className="mt-1 w-full rounded-md border border-[#d8c7b8] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-[#6f5b4f]">
              Capacity
              <input
                type="number"
                min={1}
                value={row.capacity}
                onChange={(event) => updateRow(row.key, { capacity: Number(event.target.value) })}
                className="mt-1 w-full rounded-md border border-[#d8c7b8] px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => setRows((previous) => previous.filter((entry) => entry.key !== row.key))}
              disabled={rows.length <= 1}
              className="rounded-md border border-[#d8c7b8] px-2 py-1.5 text-xs font-medium text-[#5a4536] hover:bg-[#fff6ed] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((previous) => [...previous, createRow()])}
        className="mt-2 rounded-md border border-[#d8c7b8] px-3 py-1.5 text-xs font-medium text-[#5a4536] hover:bg-[#fff6ed]"
      >
        + Add session
      </button>

      {error && <p className="mt-3 text-xs font-medium text-red-700">{error}</p>}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-[#ed7f2a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#dc6f1d] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Reposting…" : "Confirm Repost"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg border border-[#d8c7b8] bg-white px-4 py-2 text-sm font-semibold text-[#5a4536] hover:bg-[#fff6ed]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
