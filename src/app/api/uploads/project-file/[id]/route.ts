import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { readProjectFile } from "@/lib/project-uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Authenticated, gated download of a Project supporting document.
 * `[id]` is the ProjectFile id; the stored filename is resolved from the
 * database, never taken from the URL, so arbitrary paths cannot be requested.
 * Only the owning project's creator (or an ADMIN) may access the file.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const record = await prisma.projectFile.findUnique({
    where: { id },
    select: {
      fileName: true,
      storedPath: true,
      project: { select: { creatorId: true } },
    },
  });

  if (!record || !record.storedPath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = record.project.creatorId === session.userId;
  const isAdmin = session.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const file = await readProjectFile(record.storedPath);
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const asciiName = record.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.buffer.byteLength),
      "Content-Disposition": `attachment; filename="${asciiName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
