"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, X } from "lucide-react";
import type { ProductCategory, ProjectStatus } from "@prisma/client";
import { createProject, updateProject } from "@/app/actions/project-actions";
import { CATEGORY_OPTIONS } from "@/lib/projects/labels";

export type ProjectFormValues = {
  name: string;
  category: ProductCategory | "";
  targetConsumer: string;
  targetPrice: string;
  description: string;
  productType: string;
  innovationStage: string;
  objectives: string;
  keyIngredients: string;
  intendedMarket: string;
  notes: string;
};

const EMPTY: ProjectFormValues = {
  name: "",
  category: "",
  targetConsumer: "",
  targetPrice: "",
  description: "",
  productType: "",
  innovationStage: "",
  objectives: "",
  keyIngredients: "",
  intendedMarket: "",
  notes: "",
};

type Props = {
  mode: "create" | "edit";
  projectId?: string;
  status?: ProjectStatus;
  initial?: Partial<ProjectFormValues>;
  triggerClassName?: string;
  triggerLabel?: string;
};

export function ProjectFormModal({
  mode,
  projectId,
  initial,
  triggerClassName,
  triggerLabel,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ProjectFormValues>({ ...EMPTY, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const openModal = () => {
    setValues({ ...EMPTY, ...initial });
    setError(null);
    setOpen(true);
  };

  const submit = () => {
    setError(null);
    if (!values.name.trim() || !values.category || !values.targetConsumer.trim() || !values.targetPrice.trim() || !values.description.trim()) {
      setError("Please complete all required fields.");
      return;
    }
    const payload = {
      name: values.name.trim(),
      category: values.category as ProductCategory,
      targetConsumer: values.targetConsumer.trim(),
      targetPrice: values.targetPrice.trim(),
      description: values.description.trim(),
      productType: values.productType.trim() || undefined,
      innovationStage: values.innovationStage.trim() || undefined,
      objectives: values.objectives.trim() || undefined,
      keyIngredients: values.keyIngredients.trim() || undefined,
      intendedMarket: values.intendedMarket.trim() || undefined,
      notes: values.notes.trim() || undefined,
    };

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createProject(payload)
          : await updateProject(projectId as string, payload);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (mode === "create" && "projectId" in result) {
        router.push(`/msme/dashboard?view=projects&projectId=${result.projectId}`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={
          triggerClassName ??
          "inline-flex items-center justify-center gap-2 rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(249,115,22,0.24)] transition hover:bg-[#ea580c]"
        }
      >
        {mode === "create" ? <Plus size={16} /> : <Pencil size={14} />}
        {triggerLabel ?? (mode === "create" ? "New Project" : "Edit")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0f172a]/40 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.24)]">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#0f172a]">
                  {mode === "create" ? "New Project" : "Edit Project"}
                </h2>
                <p className="text-xs text-[#64748b]">Define the core product concept for your workspace.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}

              <section className="space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#94a3b8]">Core concept</p>
                <Field label="Project Name" required>
                  <input
                    value={values.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. Coffee Pulp Breakfast Flakes"
                    className={inputClass}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Category" required>
                    <select
                      value={values.category}
                      onChange={(e) => set("category", e.target.value as ProductCategory)}
                      className={inputClass}
                    >
                      <option value="">Select category</option>
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Target Price" required>
                    <input
                      value={values.targetPrice}
                      onChange={(e) => set("targetPrice", e.target.value)}
                      placeholder="e.g. ₱35 per serving"
                      className={inputClass}
                    />
                  </Field>
                </div>
                <Field label="Target Consumer" required>
                  <input
                    value={values.targetConsumer}
                    onChange={(e) => set("targetConsumer", e.target.value)}
                    placeholder="e.g. Young professionals"
                    className={inputClass}
                  />
                </Field>
                <Field label="Description" required>
                  <textarea
                    value={values.description}
                    onChange={(e) => set("description", e.target.value)}
                    rows={3}
                    placeholder="High fiber breakfast cereal using coffee pulp."
                    className={inputClass}
                  />
                </Field>
              </section>

              <section className="space-y-4 border-t border-[#e2e8f0] pt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#94a3b8]">
                  Optional details
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Product Type">
                    <input value={values.productType} onChange={(e) => set("productType", e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Innovation Stage">
                    <input value={values.innovationStage} onChange={(e) => set("innovationStage", e.target.value)} className={inputClass} />
                  </Field>
                </div>
                <Field label="Objectives">
                  <textarea value={values.objectives} onChange={(e) => set("objectives", e.target.value)} rows={2} className={inputClass} />
                </Field>
                <Field label="Key Ingredients">
                  <textarea value={values.keyIngredients} onChange={(e) => set("keyIngredients", e.target.value)} rows={2} className={inputClass} />
                </Field>
                <Field label="Intended Market">
                  <input value={values.intendedMarket} onChange={(e) => set("intendedMarket", e.target.value)} className={inputClass} />
                </Field>
                <Field label="Notes">
                  <textarea value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={inputClass} />
                </Field>
              </section>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#e2e8f0] px-6 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={isPending}
                className="rounded-lg bg-[#f97316] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(249,115,22,0.24)] transition hover:bg-[#ea580c] disabled:opacity-60"
              >
                {isPending ? "Saving…" : mode === "create" ? "Create Project" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputClass =
  "w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#1e293b] outline-none transition focus:border-[#fdba74] focus:ring-2 focus:ring-[#fed7aa]";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-[#475569]">
        {label}
        {required && <span className="text-[#f97316]"> *</span>}
      </span>
      {children}
    </label>
  );
}
