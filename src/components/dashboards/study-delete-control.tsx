"use client";

import { useState } from "react";
import { deleteStudyWithPassword } from "@/app/actions/study-actions";

export function StudyDeleteControl({ studyId, redirectTo }: { studyId: string; redirectTo: string }) {
  const [showConfirm, setShowConfirm] = useState(false);

  if (!showConfirm) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          Delete Study
        </button>
      </div>
    );
  }

  return (
    <form action={deleteStudyWithPassword} className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <input type="hidden" name="studyId" value={studyId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Confirm Delete</p>
      <p className="mt-1 text-xs text-red-700">
        Enter your MSME account password to permanently delete this study.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs text-red-800">
          Confirm password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-[#2e231c] outline-none focus:border-red-400"
            placeholder="Enter password"
            required
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Confirm Delete
        </button>
        <button
          type="button"
          onClick={() => setShowConfirm(false)}
          className="rounded-lg border border-[#d8c7b8] bg-white px-4 py-2 text-sm font-semibold text-[#5a4536] hover:bg-[#fff6ed]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
