"use client";

import { useState } from "react";
import { FACILITIES_BY_REGION, REGIONS, isValidRegion } from "@/lib/facility-constants";

type FicAssignmentFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  redirectTo: string;
  assignedRegion: string | null;
  assignedFacility: string | null;
};

export function FicAssignmentForm({ action, redirectTo, assignedRegion, assignedFacility }: FicAssignmentFormProps) {
  const initialRegion = assignedRegion && isValidRegion(assignedRegion) ? assignedRegion : "";
  const [region, setRegion] = useState<string>(initialRegion);
  const facilities = region && isValidRegion(region) ? [...FACILITIES_BY_REGION[region]] : [];
  const initialFacility =
    assignedFacility && facilities.includes(assignedFacility as (typeof facilities)[number]) ? assignedFacility : "";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium text-[#5d493b]">
            Region <span className="text-[#c2410c]">*</span>
          </span>
          <select
            name="assignedRegion"
            className="app-select w-full"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            required
          >
            <option value="" disabled>
              Select Region
            </option>
            {REGIONS.map((option) => (
              <option key={`fic-assignment-region-${option}`} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-[#5d493b]">
            Facility <span className="text-[#c2410c]">*</span>
          </span>
          {/* Keyed on region so switching region resets the facility choice. */}
          <select
            key={`fic-assignment-facility-${region}`}
            name="assignedFacility"
            className="app-select w-full"
            defaultValue={initialFacility}
            disabled={!region}
            required
          >
            <option value="" disabled>
              {region ? "Select Facility" : "Select Region First"}
            </option>
            {facilities.map((facility) => (
              <option key={`fic-assignment-facility-${facility}`} value={facility}>
                {facility}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="app-button-primary inline-flex items-center justify-center px-5 py-2.5">
          Save Region &amp; Facility
        </button>
      </div>
    </form>
  );
}
