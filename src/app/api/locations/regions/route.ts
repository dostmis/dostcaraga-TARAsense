import { NextRequest, NextResponse } from "next/server";
import { listRegions } from "@/lib/locations/psgc-queries";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const regions = await listRegions(query);
  return NextResponse.json({ items: regions });
}
