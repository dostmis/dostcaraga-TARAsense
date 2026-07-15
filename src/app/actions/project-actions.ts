"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth/session";
import { Prisma, ProductCategory, ProjectStatus } from "@prisma/client";
import { z } from "zod";
import {
  saveProjectFile,
  deleteProjectFile,
  MAX_PROJECT_FILE_BYTES,
} from "@/lib/project-uploads";

/**
 * Server actions for the Projects workspace (product-development containers).
 * Every mutation is gated to MSME/ADMIN and scoped to the owning creator, and
 * records a ProjectActivity entry so the timeline stays truthful.
 */

const PROJECT_VIEW_PATH = "/msme/dashboard";

const CATEGORY_VALUES = Object.values(ProductCategory) as [ProductCategory, ...ProductCategory[]];

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));
}

// Innovators asked for effectively no word limit on the free-text detail fields.
// We keep a generous safety ceiling (well beyond any realistic write-up) so the
// DB/UI can't be abused with multi-megabyte payloads, but users never hit it.
const DETAIL_MAX = 50_000;

const ProjectInputSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(300),
  category: z.enum(CATEGORY_VALUES),
  targetConsumer: z.string().trim().min(1, "Target consumer is required.").max(DETAIL_MAX),
  targetPrice: z.string().trim().min(1, "Target price is required.").max(200),
  description: z.string().trim().min(1, "Description is required.").max(DETAIL_MAX),
  productType: optionalText(DETAIL_MAX),
  innovationStage: optionalText(DETAIL_MAX),
  objectives: optionalText(DETAIL_MAX),
  keyIngredients: optionalText(DETAIL_MAX),
  intendedMarket: optionalText(DETAIL_MAX),
  notes: optionalText(DETAIL_MAX),
});

type ProjectActionResult =
  | { success: true; projectId: string }
  | { success: false; error: string };

type SimpleResult = { success: true } | { success: false; error: string };

async function requireInnovator() {
  const session = await getCurrentSession();
  if (!session) {
    return { session: null, error: "You must be signed in." };
  }
  if (session.role !== "MSME" && session.role !== "FIC" && session.role !== "ADMIN") {
    return { session: null, error: "Only innovators can manage projects." };
  }
  return { session, error: null };
}

/** Loads a project the caller is allowed to mutate (owner or ADMIN). */
async function loadOwnedProject(projectId: string, userId: string, isAdmin: boolean) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, creatorId: true, name: true, status: true },
  });
  if (!project) {
    return { project: null, error: "Project not found." };
  }
  if (project.creatorId !== userId && !isAdmin) {
    return { project: null, error: "You do not have access to this project." };
  }
  return { project, error: null };
}

async function recordActivity(
  projectId: string,
  actorId: string | null,
  type: string,
  summary: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  await client.projectActivity.create({
    data: { projectId, actorId, type, summary },
  });
}

export async function createProject(
  data: z.infer<typeof ProjectInputSchema>
): Promise<ProjectActionResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }

  const parsed = ProjectInputSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid project details." };
  }
  const input = parsed.data;

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        creatorId: session.userId,
        name: input.name,
        category: input.category,
        targetConsumer: input.targetConsumer,
        targetPrice: input.targetPrice,
        description: input.description,
        productType: input.productType,
        innovationStage: input.innovationStage,
        objectives: input.objectives,
        keyIngredients: input.keyIngredients,
        intendedMarket: input.intendedMarket,
        notes: input.notes,
        status: "DRAFT",
      },
      select: { id: true, name: true },
    });
    await recordActivity(
      created.id,
      session.userId,
      "PROJECT_CREATED",
      `Project “${created.name}” created`,
      tx
    );
    return created;
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true, projectId: project.id };
}

export async function updateProject(
  projectId: string,
  data: z.infer<typeof ProjectInputSchema> & { status?: ProjectStatus }
): Promise<ProjectActionResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }

  const { project, error: accessError } = await loadOwnedProject(
    projectId,
    session.userId,
    session.role === "ADMIN"
  );
  if (!project) {
    return { success: false, error: accessError };
  }

  const parsed = ProjectInputSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid project details." };
  }
  const input = parsed.data;
  const nextStatus =
    data.status && Object.values(ProjectStatus).includes(data.status) ? data.status : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        category: input.category,
        targetConsumer: input.targetConsumer,
        targetPrice: input.targetPrice,
        description: input.description,
        productType: input.productType ?? null,
        innovationStage: input.innovationStage ?? null,
        objectives: input.objectives ?? null,
        keyIngredients: input.keyIngredients ?? null,
        intendedMarket: input.intendedMarket ?? null,
        notes: input.notes ?? null,
        ...(nextStatus ? { status: nextStatus } : {}),
      },
    });
    await recordActivity(projectId, session.userId, "PROJECT_UPDATED", "Project details updated", tx);
    if (nextStatus && nextStatus !== project.status) {
      await recordActivity(
        projectId,
        session.userId,
        "STATUS_CHANGED",
        `Status changed to ${formatStatus(nextStatus)}`,
        tx
      );
    }
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true, projectId };
}

export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus
): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  if (!Object.values(ProjectStatus).includes(status)) {
    return { success: false, error: "Invalid status." };
  }
  const { project, error: accessError } = await loadOwnedProject(
    projectId,
    session.userId,
    session.role === "ADMIN"
  );
  if (!project) {
    return { success: false, error: accessError };
  }
  if (project.status === status) {
    return { success: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { status } });
    await recordActivity(
      projectId,
      session.userId,
      "STATUS_CHANGED",
      `Status changed to ${formatStatus(status)}`,
      tx
    );
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

export async function archiveProject(projectId: string): Promise<SimpleResult> {
  return setProjectStatus(projectId, "ARCHIVED");
}

/** Links an existing study the caller owns to a project (or unlinks when studyId already linked). */
export async function linkStudyToProject(
  projectId: string,
  studyId: string
): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  const isAdmin = session.role === "ADMIN";
  const { project, error: accessError } = await loadOwnedProject(projectId, session.userId, isAdmin);
  if (!project) {
    return { success: false, error: accessError };
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: { id: true, title: true, creatorId: true, projectId: true },
  });
  if (!study) {
    return { success: false, error: "Study not found." };
  }
  if (study.creatorId !== session.userId && !isAdmin) {
    return { success: false, error: "You do not own that study." };
  }
  if (study.projectId === projectId) {
    return { success: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.study.update({ where: { id: studyId }, data: { projectId } });
    await recordActivity(
      projectId,
      session.userId,
      "STUDY_LINKED",
      `Study “${study.title}” linked`,
      tx
    );
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

export async function unlinkStudyFromProject(
  projectId: string,
  studyId: string
): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  const isAdmin = session.role === "ADMIN";
  const { project, error: accessError } = await loadOwnedProject(projectId, session.userId, isAdmin);
  if (!project) {
    return { success: false, error: accessError };
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: { id: true, title: true, projectId: true },
  });
  if (!study || study.projectId !== projectId) {
    return { success: false, error: "Study is not linked to this project." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.study.update({ where: { id: studyId }, data: { projectId: null } });
    await recordActivity(
      projectId,
      session.userId,
      "STUDY_UNLINKED",
      `Study “${study.title}” unlinked`,
      tx
    );
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

const NoteSchema = z.object({
  projectId: z.string().min(1),
  body: z.string().trim().min(1, "Note cannot be empty.").max(4000),
});

export async function addProjectNote(input: z.infer<typeof NoteSchema>): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  const parsed = NoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }
  const { project, error: accessError } = await loadOwnedProject(
    parsed.data.projectId,
    session.userId,
    session.role === "ADMIN"
  );
  if (!project) {
    return { success: false, error: accessError };
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectNote.create({
      data: { projectId: project.id, authorId: session.userId, body: parsed.data.body },
    });
    await recordActivity(project.id, session.userId, "NOTE_ADDED", "Notes updated", tx);
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

export async function updateProjectNote(
  noteId: string,
  body: string
): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  const trimmed = (body ?? "").trim();
  if (!trimmed) {
    return { success: false, error: "Note cannot be empty." };
  }
  if (trimmed.length > 4000) {
    return { success: false, error: "Note is too long." };
  }

  const note = await prisma.projectNote.findUnique({
    where: { id: noteId },
    select: { id: true, projectId: true, project: { select: { creatorId: true } } },
  });
  if (!note) {
    return { success: false, error: "Note not found." };
  }
  if (note.project.creatorId !== session.userId && session.role !== "ADMIN") {
    return { success: false, error: "You do not have access to this note." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectNote.update({ where: { id: noteId }, data: { body: trimmed } });
    await recordActivity(note.projectId, session.userId, "NOTE_UPDATED", "Notes updated", tx);
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

export async function deleteProjectNote(noteId: string): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  const note = await prisma.projectNote.findUnique({
    where: { id: noteId },
    select: { id: true, projectId: true, project: { select: { creatorId: true } } },
  });
  if (!note) {
    return { success: false, error: "Note not found." };
  }
  if (note.project.creatorId !== session.userId && session.role !== "ADMIN") {
    return { success: false, error: "You do not have access to this note." };
  }

  await prisma.projectNote.delete({ where: { id: noteId } });
  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

/** Uploads a supporting document (multipart FormData) to a project. */
export async function uploadProjectFile(formData: FormData): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  const projectId = formData.get("projectId");
  const file = formData.get("file");
  if (typeof projectId !== "string" || !projectId) {
    return { success: false, error: "Missing project." };
  }
  if (!(file instanceof File)) {
    return { success: false, error: "No file selected." };
  }
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    return { success: false, error: "File must be 20MB or smaller." };
  }

  const { project, error: accessError } = await loadOwnedProject(
    projectId,
    session.userId,
    session.role === "ADMIN"
  );
  if (!project) {
    return { success: false, error: accessError };
  }

  const saved = await saveProjectFile(file);
  if (!saved.ok) {
    return { success: false, error: saved.error };
  }

  const displayName = sanitizeFileName(file.name);
  await prisma.$transaction(async (tx) => {
    await tx.projectFile.create({
      data: {
        projectId: project.id,
        fileName: displayName,
        storedPath: saved.storedPath,
        contentType: saved.contentType,
        sizeBytes: saved.sizeBytes,
        uploadedById: session.userId,
      },
    });
    await recordActivity(
      project.id,
      session.userId,
      "FILE_UPLOADED",
      `File “${displayName}” uploaded`,
      tx
    );
  });

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

export async function deleteProjectFileRecord(fileId: string): Promise<SimpleResult> {
  const { session, error } = await requireInnovator();
  if (!session) {
    return { success: false, error };
  }
  const record = await prisma.projectFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      projectId: true,
      fileName: true,
      storedPath: true,
      project: { select: { creatorId: true } },
    },
  });
  if (!record) {
    return { success: false, error: "File not found." };
  }
  if (record.project.creatorId !== session.userId && session.role !== "ADMIN") {
    return { success: false, error: "You do not have access to this file." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectFile.delete({ where: { id: fileId } });
    await recordActivity(
      record.projectId,
      session.userId,
      "FILE_DELETED",
      `File “${record.fileName}” deleted`,
      tx
    );
  });
  await deleteProjectFile(record.storedPath);

  revalidatePath(PROJECT_VIEW_PATH);
  return { success: true };
}

function sanitizeFileName(name: string): string {
  const base = (name ?? "").split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[\x00-\x1f<>:"/\\|?*]+/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "file";
}

function formatStatus(status: ProjectStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
