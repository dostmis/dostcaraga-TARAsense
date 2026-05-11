"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStudyAndImportFromFile } from "@/app/actions/study-import-actions";

type ImportIssue = {
  rowNumber?: number;
  field?: string;
  message: string;
};

type ImportCreateResult = {
  success?: boolean;
  valid?: boolean;
  error?: string;
  rowsRead?: number;
  rowsParsed?: number;
  rowsRejected?: number;
  respondents?: number;
  sampleCount?: number;
  attributeCount?: number;
  sampleLabels?: string[];
  warnings?: ImportIssue[];
  errors?: ImportIssue[];
  redirectPath?: string;
};

const REQUIRED_COLUMNS = ["Respondent_ID", "Sample", "Overall_Liking", "Attribute", "JAR_Score"];
const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".csv"];

export function CreateStudyImportPanel() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportCreateResult | null>(null);

  const onCreateFromImportFile = () => {
    if (!file) {
      setResult({ success: false, error: "Choose an Excel/CSV file first." });
      return;
    }

    const normalizedName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_IMPORT_EXTENSIONS.some((extension) => normalizedName.endsWith(extension));
    if (!hasValidExtension) {
      setResult({ success: false, error: "Invalid file type. Please upload an Excel (.xlsx) or CSV (.csv) file." });
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const actionResult = await createStudyAndImportFromFile(formData);
      setResult(actionResult);

      if (actionResult.success && actionResult.valid && actionResult.redirectPath) {
        router.push(actionResult.redirectPath);
      }
    });
  };

  return (
    <section className="space-y-4 rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] p-5 sm:p-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-[#1e3a8a]">Import Existing Sensory Dataset</h2>
        <p className="text-sm text-[#334155]">
          Upload a completed sensory Excel/CSV file and TARAsense will auto-create the study, import respondents,
          compute analysis, and mark the study as completed.
        </p>
        <p className="text-xs text-[#475569]">Required columns: {REQUIRED_COLUMNS.join(", ")}</p>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
          }}
          className="block w-full rounded-md border border-[#93c5fd] bg-white px-3 py-2 text-sm text-[#334155] file:mr-3 file:rounded file:border-0 file:bg-[#2563eb] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
        />
        <button
          type="button"
          onClick={onCreateFromImportFile}
          disabled={isPending}
          className="rounded-md border border-[#1d4ed8] bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Processing..." : "Create Study + Import + Analyze"}
        </button>
      </div>

      {result?.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      )}

      {result && !result.error && (
        <div className="space-y-2 rounded-md border border-[#dbeafe] bg-white px-3 py-2 text-xs text-[#334155]">
          <p className="font-medium text-[#0f172a]">
            Import Preview: {result.valid ? "Ready/Completed" : "Validation issues found"}
          </p>
          <p>
            Rows read: {result.rowsRead ?? 0} | Parsed: {result.rowsParsed ?? 0} | Rejected: {result.rowsRejected ?? 0}
          </p>
          <p>
            Respondents: {result.respondents ?? 0} | Samples: {result.sampleCount ?? 0} | Attributes: {result.attributeCount ?? 0}
          </p>
          {result.sampleLabels && result.sampleLabels.length > 0 && <p>Sample labels: {result.sampleLabels.join(", ")}</p>}
          {result.warnings && result.warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              {result.warnings.slice(0, 6).map((warning, index) => (
                <p key={`create-import-warning-${index}`}>{formatIssue(warning)}</p>
              ))}
              {result.warnings.length > 6 && <p>...and {result.warnings.length - 6} more warning(s).</p>}
            </div>
          )}
          {result.errors && result.errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              {result.errors.slice(0, 8).map((issue, index) => (
                <p key={`create-import-error-${index}`}>{formatIssue(issue)}</p>
              ))}
              {result.errors.length > 8 && <p>...and {result.errors.length - 8} more error(s).</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatIssue(issue: ImportIssue) {
  const rowPrefix = issue.rowNumber ? `Row ${issue.rowNumber}: ` : "";
  const fieldPrefix = issue.field ? `${issue.field} - ` : "";
  return `${rowPrefix}${fieldPrefix}${issue.message}`;
}
