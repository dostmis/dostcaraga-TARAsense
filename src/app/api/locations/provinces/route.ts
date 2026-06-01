import { NextRequest, NextResponse } from "next/server";
import { listProvinces } from "@/lib/locations/psgc-queries";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const regionId = request.nextUrl.searchParams.get("regionId");
  if (!regionId) {
    return NextResponse.json({ error: "regionId is required" }, { status: 400 });
  }
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const provinces = await listProvinces(regionId, query);
  return NextResponse.json({ items: provinces });
}
