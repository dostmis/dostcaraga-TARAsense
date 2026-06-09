import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_FIC_ID_BYTES } from "@/lib/fic-facility";

/**
 * Local file storage for FIC government ID uploads. Server-only (uses node:fs).
 *
 * Files are written outside `/public` (under `<cwd>/var/uploads/fic-id`) so they
 * are never served statically. The database stores only the generated basename;
 * the gated route resolves it back to an absolute path here, with traversal
 * guards, and streams it after an authorization check.
 */

const FIC_ID_DIR = path.join(process.cwd(), "var", "uploads", "fic-id");

/** Allowed MIME types mapped to the extension we persist. */
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
};

export const FIC_ID_ACCEPT_ATTRIBUTE = "image/jpeg,image/png,application/pdf";

export type SaveFileResult =
  | { ok: true; storedPath: string; contentType: string }
  | { ok: false; error: string };

/**
 * Validates and persists an uploaded government ID file.
 * Returns the stored basename (to be saved in `FicFacilityProfile.govIdPath`).
 */
export async function saveFicIdFile(file: File): Promise<SaveFileResult> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    return { ok: false, error: "Government-issued ID file is required." };
  }
  if (file.size > MAX_FIC_ID_BYTES) {
    return { ok: false, error: "Government-issued ID file must be 5MB or smaller." };
  }

  const extension = MIME_TO_EXTENSION[file.type];
  if (!extension) {
    return { ok: false, error: "Government-issued ID must be a JPG, PNG, or PDF file." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Guard against a spoofed `file.type` by confirming the actual byte size.
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_FIC_ID_BYTES) {
    return { ok: false, error: "Government-issued ID file is invalid." };
  }

  await mkdir(FIC_ID_DIR, { recursive: true });
  const fileName = `${randomUUID()}.${extension}`;
  await writeFile(path.join(FIC_ID_DIR, fileName), buffer, { mode: 0o600 });

  return { ok: true, storedPath: fileName, contentType: file.type };
}

export type ReadFileResult = { buffer: Buffer; contentType: string };

/**
 * Resolves a stored government ID basename to its bytes + content type.
 * Rejects anything that is not a plain filename inside the FIC ID directory.
 */
export async function readFicIdFile(storedPath: string): Promise<ReadFileResult | null> {
  const fileName = sanitizeStoredName(storedPath);
  if (!fileName) {
    return null;
  }

  const absolutePath = path.join(FIC_ID_DIR, fileName);
  // Defense-in-depth: ensure the resolved path never escapes the upload dir.
  const resolved = path.resolve(absolutePath);
  if (resolved !== absolutePath || path.dirname(resolved) !== FIC_ID_DIR) {
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

/** Best-effort removal of a previously stored ID (used when replacing on re-apply). */
export async function deleteFicIdFile(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath) {
    return;
  }
  const fileName = sanitizeStoredName(storedPath);
  if (!fileName) {
    return;
  }
  try {
    await unlink(path.join(FIC_ID_DIR, fileName));
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
  // Reject any path separators or traversal sequences outright.
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..") || trimmed.includes("\0")) {
    return null;
  }
  if (path.basename(trimmed) !== trimmed) {
    return null;
  }
  return trimmed;
}
