"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, MapPin, Search, X } from "lucide-react";

export type LocationValue = {
  regionId: string | null;
  provinceId: string | null;
  cityId: string | null;
  barangayId: string | null;
};

export type LocationLabels = {
  region?: string | null;
  province?: string | null;
  city?: string | null;
  barangay?: string | null;
};

type LocationPickerProps = {
  value: LocationValue;
  onChange: (next: LocationValue, labels: LocationLabels) => void;
  /** Hide barangay tier — used for study targeting scopes that stop short. */
  maxLevel?: "region" | "province" | "city" | "barangay";
  /** Render disabled (e.g. when FIC inheritance is locked). */
  disabled?: boolean;
  /** Optional pre-filled labels (used when the parent already knows them). */
  initialLabels?: LocationLabels;
  /** Hidden form field name prefix — when supplied, hidden inputs are rendered. */
  nameRegion?: string;
  nameProvince?: string;
  nameCity?: string;
  nameBarangay?: string;
  required?: boolean;
};

type Option = { id: string; code: string; name: string };

const levelOrder: Array<"region" | "province" | "city" | "barangay"> = [
  "region",
  "province",
  "city",
  "barangay",
];

const endpointForLevel: Record<(typeof levelOrder)[number], string> = {
  region: "/api/locations/regions",
  province: "/api/locations/provinces",
  city: "/api/locations/cities",
  barangay: "/api/locations/barangays",
};

const queryParamForParent: Record<(typeof levelOrder)[number], string | null> = {
  region: null,
  province: "regionId",
  city: "provinceId",
  barangay: "cityId",
};

export function LocationPicker({
  value,
  onChange,
  maxLevel = "barangay",
  disabled,
  initialLabels,
  nameRegion,
  nameProvince,
  nameCity,
  nameBarangay,
  required,
}: LocationPickerProps) {
  const [labels, setLabels] = useState<LocationLabels>(initialLabels ?? {});

  const handleChange = useCallback(
    (level: (typeof levelOrder)[number], picked: Option | null) => {
      const next: LocationValue = { ...value };
      const newLabels: LocationLabels = { ...labels };

      const cascadeIndex = levelOrder.indexOf(level);
      // Clear deeper levels
      for (let i = cascadeIndex; i < levelOrder.length; i += 1) {
        const key = levelOrder[i];
        if (key === "region") {
          next.regionId = picked && i === cascadeIndex ? picked.id : null;
          newLabels.region = picked && i === cascadeIndex ? picked.name : null;
        } else if (key === "province") {
          next.provinceId = picked && i === cascadeIndex ? picked.id : null;
          newLabels.province = picked && i === cascadeIndex ? picked.name : null;
        } else if (key === "city") {
          next.cityId = picked && i === cascadeIndex ? picked.id : null;
          newLabels.city = picked && i === cascadeIndex ? picked.name : null;
        } else if (key === "barangay") {
          next.barangayId = picked && i === cascadeIndex ? picked.id : null;
          newLabels.barangay = picked && i === cascadeIndex ? picked.name : null;
        }
      }

      setLabels(newLabels);
      onChange(next, newLabels);
    },
    [labels, onChange, value],
  );

  const maxIndex = levelOrder.indexOf(maxLevel);
  const visibleLevels = levelOrder.slice(0, maxIndex + 1);

  const parentId = (level: (typeof levelOrder)[number]): string | null => {
    if (level === "region") return null;
    if (level === "province") return value.regionId;
    if (level === "city") return value.provinceId;
    if (level === "barangay") return value.cityId;
    return null;
  };

  const currentSelection = (level: (typeof levelOrder)[number]): Option | null => {
    if (level === "region")
      return value.regionId ? { id: value.regionId, code: "", name: labels.region ?? "" } : null;
    if (level === "province")
      return value.provinceId ? { id: value.provinceId, code: "", name: labels.province ?? "" } : null;
    if (level === "city")
      return value.cityId ? { id: value.cityId, code: "", name: labels.city ?? "" } : null;
    return value.barangayId ? { id: value.barangayId, code: "", name: labels.barangay ?? "" } : null;
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {visibleLevels.map((level) => {
        const parent = parentId(level);
        const disabledLevel = disabled || (level !== "region" && !parent);
        return (
          <SearchableSelect
            key={level}
            level={level}
            disabled={disabledLevel}
            required={required}
            parentParamValue={parent}
            selection={currentSelection(level)}
            onPick={(picked) => handleChange(level, picked)}
          />
        );
      })}

      {nameRegion ? (
        <input type="hidden" name={nameRegion} value={value.regionId ?? ""} />
      ) : null}
      {nameProvince ? (
        <input type="hidden" name={nameProvince} value={value.provinceId ?? ""} />
      ) : null}
      {nameCity ? <input type="hidden" name={nameCity} value={value.cityId ?? ""} /> : null}
      {nameBarangay ? (
        <input type="hidden" name={nameBarangay} value={value.barangayId ?? ""} />
      ) : null}
    </div>
  );
}

type SearchableSelectProps = {
  level: (typeof levelOrder)[number];
  selection: Option | null;
  parentParamValue: string | null;
  disabled?: boolean;
  required?: boolean;
  onPick: (picked: Option | null) => void;
};

const LEVEL_LABEL: Record<(typeof levelOrder)[number], string> = {
  region: "Region",
  province: "Province",
  city: "City / Municipality",
  barangay: "Barangay",
};

function SearchableSelect({
  level,
  selection,
  parentParamValue,
  disabled,
  required,
  onPick,
}: SearchableSelectProps) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Debounced fetch
  useEffect(() => {
    if (!open) return;
    const parentParam = queryParamForParent[level];
    if (parentParam && !parentParamValue) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (parentParam && parentParamValue) {
          params.set(parentParam, parentParamValue);
        }
        if (query.trim()) {
          params.set("q", query.trim());
        }
        const url = `${endpointForLevel[level]}?${params.toString()}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
        const data = (await res.json()) as { items: Option[] };
        setOptions(data.items ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [level, open, parentParamValue, query]);

  // Click-outside dismiss
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const placeholder = useMemo(() => {
    if (disabled && !selection) {
      const parent = level === "province" ? "region" : level === "city" ? "province" : "city";
      return `Select ${parent} first`;
    }
    return `Select ${LEVEL_LABEL[level].toLowerCase()}`;
  }, [disabled, level, selection]);

  return (
    <div ref={wrapperRef} className="relative">
      <label
        htmlFor={inputId}
        className="mb-1 block text-xs font-medium"
        style={{ color: "var(--muted-foreground)" }}
      >
        {LEVEL_LABEL[level]}
        {required ? <span style={{ color: "var(--support)" }}> *</span> : null}
      </label>
      <button
        id={inputId}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition focus:outline-none disabled:cursor-not-allowed"
        style={{
          borderColor: open ? "var(--ring)" : "var(--input)",
          background: disabled ? "var(--surface-muted)" : "var(--card)",
          color: selection ? "var(--foreground)" : "var(--muted-foreground)",
          boxShadow: open
            ? "0 0 0 3px color-mix(in srgb, var(--ring) 24%, transparent)"
            : "none",
        }}
      >
        <span className="flex items-center gap-2 truncate">
          <MapPin
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--muted-foreground)" }}
          />
          <span className="truncate">{selection?.name || placeholder}</span>
        </span>
        <span className="flex items-center gap-1">
          {selection && !disabled ? (
            <span
              role="button"
              aria-label="Clear"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onPick(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                  event.preventDefault();
                  onPick(null);
                }
              }}
              className="rounded p-0.5 transition hover:bg-[color:var(--surface-muted)]"
              style={{ color: "var(--muted-foreground)" }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronDown
            className="h-3.5 w-3.5"
            style={{ color: "var(--muted-foreground)" }}
          />
        </span>
      </button>
      {open ? (
        <div
          className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border shadow-lg"
          style={{
            borderColor: "var(--border)",
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            boxShadow: "var(--app-shadow-soft)",
          }}
        >
          <div
            className="flex items-center gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          >
            <Search
              className="h-3.5 w-3.5"
              style={{ color: "var(--muted-foreground)" }}
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${LEVEL_LABEL[level].toLowerCase()}…`}
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: "var(--foreground)" }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div
                className="flex items-center justify-center gap-2 px-3 py-6 text-sm"
                style={{ color: "var(--muted-foreground)" }}
              >
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : error ? (
              <div
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--destructive)" }}
              >
                {error}
              </div>
            ) : options.length === 0 ? (
              <div
                className="px-3 py-6 text-center text-sm"
                style={{ color: "var(--muted-foreground)" }}
              >
                {query.trim() ? "No matches" : "Type to search"}
              </div>
            ) : (
              <ul role="listbox" className="py-1">
                {options.map((option) => {
                  const isSelected = selection?.id === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          onPick(option);
                          setOpen(false);
                          setQuery("");
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition"
                        style={{
                          background: isSelected
                            ? "color-mix(in srgb, var(--brand) 10%, transparent)"
                            : "transparent",
                          color: "var(--foreground)",
                        }}
                        onMouseEnter={(event) => {
                          if (!isSelected) {
                            event.currentTarget.style.background =
                              "var(--surface-muted)";
                          }
                        }}
                        onMouseLeave={(event) => {
                          if (!isSelected) {
                            event.currentTarget.style.background = "transparent";
                          }
                        }}
                      >
                        <span className="truncate">{option.name}</span>
                        {isSelected ? (
                          <Check
                            className="h-3.5 w-3.5"
                            style={{ color: "var(--brand)" }}
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
