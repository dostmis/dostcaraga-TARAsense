import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { readFicIdFile } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Authenticated, gated access to an uploaded FIC government ID.
 * `[id]` is the FicFacilityProfile id; the stored filename is resolved from the
 * database, never taken from the URL, so arbitrary paths cannot be requested.
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

  const profile = await prisma.ficFacilityProfile.findUnique({
    where: { id },
    select: { userId: true, govIdPath: true },
  });

  if (!profile || !profile.govIdPath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = profile.userId === session.userId;
  const isAdmin = session.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const file = await readFicIdFile(profile.govIdPath);
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.buffer.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
