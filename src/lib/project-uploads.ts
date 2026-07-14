import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local file storage for Project supporting documents. Server-only (uses node:fs).
 *
 * Mirrors the FIC ID storage pattern in src/lib/uploads.ts: files are written
 * outside `/public` (under `<cwd>/var/uploads/project-files`) so they are never
 * served statically. The database (ProjectFile) stores only the generated
 * basename; the gated download route resolves it back to an absolute path here,
 * with traversal guards, and streams it after an authorization check.
 *
 * These files are intended to become grounded sources for TARAsense AI.
 */

const PROJECT_FILE_DIR = path.join(process.cwd(), "var", "uploads", "project-files");

/** 20MB ceiling per supporting document. */
export const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024;

/** Allowed MIME types mapped to the extension we persist. */
const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
};

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export const PROJECT_FILE_ACCEPT_ATTRIBUTE =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png";

export type SaveProjectFileResult =
  | { ok: true; storedPath: string; contentType: string; sizeBytes: number }
  | { ok: false; error: string };

/**
 * Validates and persists an uploaded project supporting document.
 * Returns the stored basename (to be saved in `ProjectFile.storedPath`).
 */
export async function saveProjectFile(file: File): Promise<SaveProjectFileResult> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    return { ok: false, error: "A file is required." };
  }
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    return { ok: false, error: "File must be 20MB or smaller." };
  }

  const extension = MIME_TO_EXTENSION[file.type];
  if (!extension) {
    return {
      ok: false,
      error: "File must be a PDF, DOCX, DOC, XLSX, XLS, CSV, JPG, or PNG.",
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Guard against a spoofed `file.type` by confirming the actual byte size.
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PROJECT_FILE_BYTES) {
    return { ok: false, error: "File is invalid." };
  }

  await mkdir(PROJECT_FILE_DIR, { recursive: true });
  const fileName = `${randomUUID()}.${extension}`;
  await writeFile(path.join(PROJECT_FILE_DIR, fileName), buffer, { mode: 0o600 });

  return {
    ok: true,
    storedPath: fileName,
    contentType: file.type,
    sizeBytes: buffer.byteLength,
  };
}

export type ReadProjectFileResult = { buffer: Buffer; contentType: string };

/**
 * Resolves a stored project file basename to its bytes + content type.
 * Rejects anything that is not a plain filename inside the project file directory.
 */
export async function readProjectFile(storedPath: string): Promise<ReadProjectFileResult | null> {
  const fileName = sanitizeStoredName(storedPath);
  if (!fileName) {
    return null;
  }

  const absolutePath = path.join(PROJECT_FILE_DIR, fileName);
  // Defense-in-depth: ensure the resolved path never escapes the upload dir.
  const resolved = path.resolve(absolutePath);
  if (resolved !== absolutePath || path.dirname(resolved) !== PROJECT_FILE_DIR) {
    return null;
  }

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXTENSION_TO_MIME[extension];
  if (!contentType) {
    return null;
  }

  try {
    const buffer = await readFile(resolved);
    return { buffer, contentType };
  } catch {
    return null;
  }
}

/** Best-effort removal of a previously stored project file. */
export async function deleteProjectFile(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath) {
    return;
  }
  const fileName = sanitizeStoredName(storedPath);
  if (!fileName) {
    return;
  }
  try {
    await unlink(path.join(PROJECT_FILE_DIR, fileName));
  } catch {
    // Ignore — file already gone or never written.
  }
}

/** Accepts only a bare filename (no separators, no traversal). */
function sanitizeStoredName(storedPath: string): string | null {
  const trimmed = (storedPath ?? "").trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..") || trimmed.includes("\0")) {
    return null;
  }
  if (path.basename(trimmed) !== trimmed) {
    return null;
  }
  return trimmed;
}
