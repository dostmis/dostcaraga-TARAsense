"use client";

import { Info, MapPin, Users2 } from "lucide-react";
import { LocationPicker, type LocationLabels, type LocationValue } from "@/components/locations/location-picker";

export type StudyTargetScope = "ALL" | "REGION" | "PROVINCE" | "CITY" | "BARANGAY";

export type StudyTargetingState = {
  scope: StudyTargetScope;
  location: LocationValue;
  labels: LocationLabels;
  /** Self-managed only — additional venue/address metadata for display. */
  venueName?: string;
  addressDetails?: string;
};

type Props = {
  coordinationMode: "FIC_ASSISTED" | "SELF_MANAGED_PUBLIC";
  value: StudyTargetingState;
  onChange: (next: StudyTargetingState) => void;
  /** When FIC-assisted, this is the inherited location preview from the chosen FIC. */
  inheritedPreview?: {
    facilityName: string | null;
    region: string | null;
    province: string | null;
    city: string | null;
    barangay: string | null;
  } | null;
};

const SCOPE_OPTIONS: Array<{ value: StudyTargetScope; label: string; description: string }> = [
  { value: "ALL", label: "Everyone", description: "Visible to all consumers nationwide" },
  { value: "REGION", label: "Same Region", description: "Only consumers in the chosen region" },
  { value: "PROVINCE", label: "Same Province", description: "Only consumers in the chosen province" },
  { value: "CITY", label: "Same City / Municipality", description: "Recommended for most local studies" },
  { value: "BARANGAY", label: "Same Barangay", description: "Hyper-local recruitment, e.g. neighborhood tasting" },
];

const SCOPE_MAX_LEVEL: Record<StudyTargetScope, "region" | "province" | "city" | "barangay" | "none"> = {
  ALL: "none",
  REGION: "region",
  PROVINCE: "province",
  CITY: "city",
  BARANGAY: "barangay",
};

export function StudyTargetingSection({ coordinationMode, value, onChange, inheritedPreview }: Props) {
  const isFicMode = coordinationMode === "FIC_ASSISTED";

  const updateScope = (scope: StudyTargetScope) => {
    // Clear levels deeper than the new scope
    const maxLevel = SCOPE_MAX_LEVEL[scope];
    const cleared: LocationValue = { ...value.location };
    if (maxLevel === "none" || maxLevel === "region") cleared.provinceId = null;
    if (maxLevel === "none" || maxLevel === "region" || maxLevel === "province") cleared.cityId = null;
    if (maxLevel !== "barangay") cleared.barangayId = null;
    if (maxLevel === "none") {
      cleared.regionId = null;
    }
    onChange({ ...value, scope, location: cleared });
  };

  return (
    <section className="space-y-4">
      <header className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "color-mix(in srgb, var(--brand) 12%, var(--card))",
            color: "var(--brand)",
          }}
        >
          <Users2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[#000080]">
            Geographical Scope
          </h2>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Choose who can see and receive notifications for this study. Filtering is enforced server-side.
          </p>
        </div>
      </header>

      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SCOPE_OPTIONS.map((option) => {
          const checked = value.scope === option.value;
          return (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition"
              style={{
                borderColor: checked
                  ? "color-mix(in srgb, var(--brand) 55%, transparent)"
                  : "var(--border)",
                background: checked
                  ? "color-mix(in srgb, var(--brand) 8%, var(--card))"
                  : "var(--card)",
              }}
            >
              <input
                type="radio"
                name="targetScope"
                value={option.value}
                checked={checked}
                onChange={() => updateScope(option.value)}
                className="mt-1 h-4 w-4"
                style={{ accentColor: "var(--brand)" }}
              />
              <span className="space-y-0.5">
                <span
                  className="block text-sm font-medium"
                  style={{ color: "var(--foreground)" }}
                >
                  {option.label}
                </span>
                <span className="block text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {isFicMode ? (
        <div
          className="rounded-lg border p-4 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--status-info) 30%, transparent)",
            background: "color-mix(in srgb, var(--status-info) 8%, var(--card))",
            color: "var(--foreground)",
          }}
        >
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--status-info)" }} />
            <div className="space-y-1">
              <p className="font-medium">Location inherited from chosen FIC</p>
              {inheritedPreview ? (
                <ul className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {inheritedPreview.facilityName ? <li>FIC: {inheritedPreview.facilityName}</li> : null}
                  {inheritedPreview.region ? <li>Region: {inheritedPreview.region}</li> : null}
                  {inheritedPreview.province ? <li>Province: {inheritedPreview.province}</li> : null}
                  {inheritedPreview.city ? <li>City: {inheritedPreview.city}</li> : null}
                  {inheritedPreview.barangay ? <li>Barangay: {inheritedPreview.barangay}</li> : null}
                </ul>
              ) : (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Choose a FIC assignee above to preview inherited region/province/city.
                </p>
              )}
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                The chosen <strong>{labelForScope(value.scope)}</strong> scope above will be applied automatically
                using the FIC&apos;s registered location. No further input needed here.
              </p>
            </div>
          </div>
        </div>
      ) : value.scope === "ALL" ? (
        <div
          className="rounded-lg border p-3 text-xs"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-muted)",
            color: "var(--muted-foreground)",
          }}
        >
          <MapPin className="mr-1 inline h-3 w-3" /> No location restriction. Notifications go to all consumers with completed profiles.
        </div>
      ) : (
        <div className="space-y-3">
          <div
            className="rounded-lg border p-3 text-xs"
            style={{
              borderColor: "color-mix(in srgb, var(--status-warning) 35%, transparent)",
              background: "color-mix(in srgb, var(--status-warning) 8%, var(--card))",
              color: "var(--foreground)",
            }}
          >
            <Info
              className="mr-1 inline h-3 w-3"
              style={{ color: "var(--status-warning)" }}
            />{" "}
            Pick the area that defines the target audience for this self-managed study.
          </div>
          <LocationPicker
            value={value.location}
            onChange={(location, labels) => onChange({ ...value, location, labels })}
            maxLevel={
              SCOPE_MAX_LEVEL[value.scope] === "none"
                ? "region"
                : (SCOPE_MAX_LEVEL[value.scope] as "region" | "province" | "city" | "barangay")
            }
            required
          />
        </div>
      )}
    </section>
  );
}

function labelForScope(scope: StudyTargetScope): string {
  return SCOPE_OPTIONS.find((option) => option.value === scope)?.label ?? scope;
}
