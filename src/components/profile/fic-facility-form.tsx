"use client";

import { useState } from "react";
import { LocationPicker, type LocationLabels, type LocationValue } from "@/components/locations/location-picker";
import {
  FIC_FACILITY_TYPE_OPTIONS,
  FIC_FIELD_LIMITS,
  FIC_ID_ACCEPT_ATTRIBUTE,
  FIC_SENSORY_CAPABILITY_OPTIONS,
} from "@/lib/fic-facility";

export type FicFacilityFormInitial = {
  facilityName: string;
  institutionName: string;
  location: LocationValue;
  locationLabels: LocationLabels;
  physicalAddress: string;
  website: string;
  directorName: string;
  position: string;
  officialEmail: string;
  contactNumber: string;
  facilityType: string;
  facilityTypeOther: string;
  sensoryCapabilities: string[];
  govIdHref: string | null;
};

type FicFacilityFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  redirectTo: string;
  submitLabel: string;
  /** Pre-fill values for re-application or profile editing. */
  initial?: FicFacilityFormInitial | null;
};

const EMPTY_LOCATION: LocationValue = { regionId: null, provinceId: null, cityId: null, barangayId: null };

export function FicFacilityForm({ action, redirectTo, submitLabel, initial }: FicFacilityFormProps) {
  const [location, setLocation] = useState<LocationValue>(initial?.location ?? EMPTY_LOCATION);
  const [facilityType, setFacilityType] = useState<string>(initial?.facilityType ?? "");
  const selectedCapabilities = new Set(initial?.sensoryCapabilities ?? []);
  const isOther = facilityType === "OTHER";
  const hasExistingId = Boolean(initial?.govIdHref);

  return (
    <form action={action} encType="multipart/form-data" className="space-y-8">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {/* Section 1 — Facility Information */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-[#2f241d]">Facility Information</h3>
          <p className="text-xs text-[#8d735f]">Tell us about the facility you represent.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Facility Name" required>
            <input
              name="facilityName"
              defaultValue={initial?.facilityName ?? ""}
              maxLength={FIC_FIELD_LIMITS.facilityName}
              className="app-input"
              required
            />
          </Field>
          <Field label="Institution / Company Name" required>
            <input
              name="institutionName"
              defaultValue={initial?.institutionName ?? ""}
              maxLength={FIC_FIELD_LIMITS.institutionName}
              className="app-input"
              required
            />
          </Field>
        </div>

        <div className="space-y-1">
          <span className="text-sm font-medium text-[#5d493b]">
            Region / Province / City <span className="text-[#c2410c]">*</span>
          </span>
          <LocationPicker
            value={location}
            onChange={(next) => setLocation(next)}
            initialLabels={initial?.locationLabels}
            maxLevel="city"
            nameRegion="regionId"
            nameProvince="provinceId"
            nameCity="cityId"
            required
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Physical Address" required>
            <input
              name="physicalAddress"
              defaultValue={initial?.physicalAddress ?? ""}
              maxLength={FIC_FIELD_LIMITS.physicalAddress}
              placeholder="Street, building, landmark"
              className="app-input"
              required
            />
          </Field>
          <Field label="Website (optional)">
            <input
              name="website"
              type="url"
              defaultValue={initial?.website ?? ""}
              maxLength={FIC_FIELD_LIMITS.website}
              placeholder="https://example.com"
              className="app-input"
            />
          </Field>
        </div>
      </section>

      {/* Section 2 — Contact Information */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-[#2f241d]">Contact Information</h3>
          <p className="text-xs text-[#8d735f]">Primary contact for this facility.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Facility Director / Head" required>
            <input
              name="directorName"
              defaultValue={initial?.directorName ?? ""}
              maxLength={FIC_FIELD_LIMITS.directorName}
              className="app-input"
              required
            />
          </Field>
          <Field label="Position / Designation" required>
            <input
              name="position"
              defaultValue={initial?.position ?? ""}
              maxLength={FIC_FIELD_LIMITS.position}
              className="app-input"
              required
            />
          </Field>
          <Field label="Official Email Address" required>
            <input
              name="officialEmail"
              type="email"
              defaultValue={initial?.officialEmail ?? ""}
              maxLength={FIC_FIELD_LIMITS.officialEmail}
              className="app-input"
              required
            />
          </Field>
          <Field label="Contact Number" required>
            <input
              name="contactNumber"
              type="tel"
              defaultValue={initial?.contactNumber ?? ""}
              maxLength={FIC_FIELD_LIMITS.contactNumber}
              placeholder="+63 9XX XXX XXXX"
              className="app-input"
              required
            />
          </Field>
        </div>

        <Field label="Government-issued ID Upload" required={!hasExistingId}>
          <input
            name="govId"
            type="file"
            accept={FIC_ID_ACCEPT_ATTRIBUTE}
            className="block w-full text-sm text-[#5d493b] file:mr-3 file:rounded-lg file:border-0 file:bg-[#f3e7da] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[#5a4536] hover:file:bg-[#ecdaca]"
            required={!hasExistingId}
          />
          <span className="text-xs text-[#8d735f]">JPG, PNG, or PDF up to 5MB.</span>
          {initial?.govIdHref ? (
            <span className="text-xs text-[#6f5b4f]">
              A document is already on file.{" "}
              <a
                href={initial.govIdHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#c2410c] underline"
              >
                View current ID
              </a>
              . Upload a new file to replace it.
            </span>
          ) : null}
        </Field>
      </section>

      {/* Section 3 — Facility Type */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-[#2f241d]">Type of Facility</h3>
          <p className="text-xs text-[#8d735f]">Select one.</p>
        </div>
        <Field label="Facility Type" required>
          <select
            name="facilityType"
            value={facilityType}
            onChange={(event) => setFacilityType(event.target.value)}
            className="app-select"
            required
          >
            <option value="" disabled>
              Select facility type
            </option>
            {FIC_FACILITY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {isOther ? (
          <Field label="Please specify" required>
            <input
              name="facilityTypeOther"
              defaultValue={initial?.facilityTypeOther ?? ""}
              maxLength={FIC_FIELD_LIMITS.facilityTypeOther}
              className="app-input"
              required
            />
          </Field>
        ) : null}
      </section>

      {/* Section 4 — Sensory Capabilities */}
      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-[#2f241d]">Sensory Testing Capability</h3>
          <p className="text-xs italic text-[#8d735f]">Check all that apply (at least one required).</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {FIC_SENSORY_CAPABILITY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 rounded-lg border border-[#e7ddd4] bg-[#fffaf4] p-3 text-sm text-[#3f2f25]"
            >
              <input
                type="checkbox"
                name="sensoryCapabilities"
                value={option.value}
                defaultChecked={selectedCapabilities.has(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button type="submit" className="app-button-primary inline-flex items-center justify-center px-5 py-2.5">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium text-[#5d493b]">
        {label}
        {required ? <span className="text-[#c2410c]"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
