"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  commitStudyImport,
  createImportReadyCloneFromFile,
  previewStudyImport,
} from "@/app/actions/study-import-actions";

type ImportIssue = {
  rowNumber?: number;
  field?: string;
  message: string;
};

type ImportResult = {
  success: boolean;
  valid?: boolean;
  error?: string;
  fileName?: string;
  fileHash?: string;
  rowsRead?: number;
  rowsParsed?: number;
  rowsRejected?: number;
  respondents?: number;
  sampleCount?: number;
  sampleLabels?: string[];
  attributeCount?: number;
  attributeNames?: string[];
  warnings?: ImportIssue[];
  errors?: ImportIssue[];
  importedAt?: string;
  newStudyId?: string;
  redirectPath?: string;
};

const REQUIRED_COLUMNS = ["Respondent_ID", "Sample", "Overall_Liking", "Attribute", "JAR_Score"];

interface StudyImportPanelProps {
  studyId: string;
}

export function StudyImportPanel({ studyId }: StudyImportPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [commit, setCommit] = useState<ImportResult | null>(null);
  const [cloneResult, setCloneResult] = useState<ImportResult | null>(null);

  const onPreview = () => {
    if (!file) {
      setPreview({ success: false, error: "Choose a CSV or XLSX file before previewing." });
      setCommit(null);
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await previewStudyImport(studyId, formData);
      setPreview(result);
      setCommit(null);
      setCloneResult(null);
    });
  };

  const onCommit = () => {
    if (!file) {
      setCommit({ success: false, error: "Choose a CSV or XLSX file before importing." });
      return;
    }

    if (!preview?.valid) {
      setCommit({ success: false, error: "Run preview validation first and resolve all issues." });
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await commitStudyImport(studyId, formData);
      setCommit(result);
      setCloneResult(null);
      if (result.success && result.valid) {
        router.refresh();
      }
    });
  };

  const onCreateImportReadyClone = () => {
    if (!file) {
      setCloneResult({ success: false, error: "Choose a CSV or XLSX file first." });
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await createImportReadyCloneFromFile(studyId, formData);
      setCloneResult(result);
      if (result.success && result.newStudyId && result.redirectPath) {
        router.push(result.redirectPath);
      }
    });
  };

  const hasAlignmentBlockingError = Boolean(
    preview?.errors?.some((issue) => {
      const text = issue.message.toLowerCase();
      return (
        text.includes("at least one jar attribute") ||
        text.includes("missing configured jar attribute") ||
        text.includes("import contains unknown attribute")
      );
    })
  );

  return (
    <section className="space-y-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
      <h3 className="text-sm font-semibold text-[#0f172a]">Import Sample Data</h3>
      <p className="text-xs text-[#64748b]">
        Phase 1 template (strict long format): {REQUIRED_COLUMNS.join(", ")}
      </p>

      <input
        type="file"
        accept=".csv,.xlsx"
        onChange={(event) => {
          const nextFile = event.target.files?.[0] ?? null;
          setFile(nextFile);
          setPreview(null);
          setCommit(null);
        }}
        className="block w-full rounded-md border border-[#dbe3ec] bg-white px-2 py-1.5 text-xs text-[#334155] file:mr-2 file:rounded file:border-0 file:bg-[#f97316] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onPreview}
          disabled={isPending}
          className="rounded-md border border-[#1d4ed8] bg-[#2563eb] px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Validating..." : "Preview Import"}
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={isPending || !preview?.valid}
          className="rounded-md border border-[#047857] bg-[#059669] px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Importing..." : "Confirm Import"}
        </button>
      </div>

      {preview?.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{preview.error}</p>
      )}

      {preview && !preview.error && (
        <div className="space-y-2 rounded-md border border-[#e2e8f0] bg-white p-2">
          <p className="text-xs font-medium text-[#0f172a]">
            Preview: {preview.valid ? "Ready to import" : "Validation issues found"}
          </p>
          <p className="text-[11px] text-[#64748b]">
            Rows read: {preview.rowsRead ?? 0} | Parsed: {preview.rowsParsed ?? 0} | Rejected: {preview.rowsRejected ?? 0}
          </p>
          <p className="text-[11px] text-[#64748b]">
            Respondents: {preview.respondents ?? 0} | Samples: {preview.sampleCount ?? 0} | Attributes: {preview.attributeCount ?? 0}
          </p>
          {preview.sampleLabels && preview.sampleLabels.length > 0 && (
            <p className="text-[11px] text-[#64748b]">Sample labels: {preview.sampleLabels.join(", ")}</p>
          )}
          {preview.warnings && preview.warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              {preview.warnings.slice(0, 8).map((warning, index) => (
                <p key={`warn-${index}`}>{formatIssue(warning)}</p>
              ))}
              {preview.warnings.length > 8 && <p>...and {preview.warnings.length - 8} more warning(s).</p>}
            </div>
          )}
          {preview.errors && preview.errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              {preview.errors.slice(0, 10).map((issue, index) => (
                <p key={`error-${index}`}>{formatIssue(issue)}</p>
              ))}
              {preview.errors.length > 10 && <p>...and {preview.errors.length - 10} more error(s).</p>}
            </div>
          )}
        </div>
      )}

      {hasAlignmentBlockingError && (
        <div className="space-y-2 rounded-md border border-[#c7d2fe] bg-[#eef2ff] px-2 py-2">
          <p className="text-[11px] text-[#3730a3]">
            This study is not fully aligned with the file attributes. Safest path: create a non-destructive import-ready clone study from this same file.
          </p>
          <button
            type="button"
            onClick={onCreateImportReadyClone}
            disabled={isPending}
            className="rounded-md border border-[#3730a3] bg-[#4338ca] px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#3730a3] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Creating clone..." : "Create Import-Ready Clone Study"}
          </button>
        </div>
      )}

      {commit?.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{commit.error}</p>
      )}

      {cloneResult?.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{cloneResult.error}</p>
      )}

      {commit && !commit.error && commit.valid === false && commit.errors && commit.errors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {commit.errors.slice(0, 8).map((issue, index) => (
            <p key={`commit-error-${index}`}>{formatIssue(issue)}</p>
          ))}
          {commit.errors.length > 8 && <p>...and {commit.errors.length - 8} more error(s).</p>}
        </div>
      )}

      {commit?.success && commit.valid && (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs text-emerald-800">
          <p className="font-semibold">Import completed and analysis was triggered.</p>
          <p>
            Imported respondents: {commit.respondents ?? 0}. Imported at:{" "}
            {commit.importedAt ? new Date(commit.importedAt).toLocaleString() : "just now"}.
          </p>
          <Link
            href={`/dashboard/${studyId}`}
            className="inline-flex rounded-md border border-emerald-700 bg-emerald-700 px-2 py-1 font-semibold text-white hover:bg-emerald-800"
          >
            Open Updated Dashboard
          </Link>
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
