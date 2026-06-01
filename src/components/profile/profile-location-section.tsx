"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react";
import { saveUserLocation } from "@/app/actions/location-actions";
import { LocationPicker, type LocationLabels, type LocationValue } from "@/components/locations/location-picker";

type Props = {
  initialValue: LocationValue;
  initialLabels: LocationLabels;
  initialAddressDetails: string | null;
  completedAt: Date | null;
};

export function ProfileLocationSection({
  initialValue,
  initialLabels,
  initialAddressDetails,
  completedAt,
}: Props) {
  const [value, setValue] = useState<LocationValue>(initialValue);
  const [labels, setLabels] = useState<LocationLabels>(initialLabels);
  const [addressDetails, setAddressDetails] = useState(initialAddressDetails ?? "");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; at: Date }
    | { kind: "error"; message: string }
  >(completedAt ? { kind: "idle" } : { kind: "idle" });

  const isComplete = Boolean(value.regionId && value.provinceId && value.cityId && value.barangayId);

  const handleSubmit = () => {
    if (!isComplete) {
      setStatus({ kind: "error", message: "Region, Province, City/Municipality, and Barangay are all required." });
      return;
    }
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await saveUserLocation({
        regionId: value.regionId!,
        provinceId: value.provinceId!,
        cityId: value.cityId!,
        barangayId: value.barangayId!,
        addressDetails: addressDetails.trim() || undefined,
      });
      if (result.success) {
        setStatus({ kind: "success", at: new Date() });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-[#2f241d]">Geographic Location</h2>
        <p className="mt-1 text-sm text-[#6f5b4f]">
          Required to discover nearby studies and receive notifications when INNOVATORs in your area open recruitment.
        </p>
      </div>

      <div
        className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs"
        style={{
          background: "color-mix(in srgb, var(--brand) 8%, var(--card))",
          borderColor: "color-mix(in srgb, var(--brand) 28%, transparent)",
          color: "var(--foreground)",
        }}
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--brand)" }} />
        <p>
          Your location helps TARAsense recommend nearby studies and opportunities.{" "}
          <strong>Exact addresses are never publicly visible.</strong>
        </p>
      </div>

      <LocationPicker
        value={value}
        onChange={(next, nextLabels) => {
          setValue(next);
          setLabels(nextLabels);
        }}
        initialLabels={labels}
        required
      />

      <label className="block space-y-1">
        <span className="text-sm font-medium text-[#5d493b]">Address details (optional)</span>
        <input
          type="text"
          value={addressDetails}
          onChange={(event) => setAddressDetails(event.target.value)}
          placeholder="Street, building, landmark"
          maxLength={280}
          className="app-input"
        />
        <span
          className="flex items-center gap-1 text-xs"
          style={{ color: "var(--muted-foreground)" }}
        >
          <Info className="h-3 w-3" /> Stored privately. Not shown to MSMEs or other consumers.
        </span>
      </label>

      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {completedAt ? (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: "var(--status-success)" }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Last saved {new Date(completedAt).toLocaleString()}
            </span>
          ) : (
            <span>Required to participate in studies.</span>
          )}
        </div>
        <button
          type="button"
          disabled={pending || !isComplete}
          onClick={handleSubmit}
          className="app-button-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save Location
        </button>
      </div>

      {status.kind === "success" ? (
        <p
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--status-success) 35%, transparent)",
            background: "color-mix(in srgb, var(--status-success) 10%, var(--card))",
            color: "var(--status-success)",
          }}
        >
          Location saved.
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--destructive) 35%, transparent)",
            background: "color-mix(in srgb, var(--destructive) 10%, var(--card))",
            color: "var(--destructive)",
          }}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
