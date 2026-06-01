import { NextRequest, NextResponse } from "next/server";
import { listBarangays } from "@/lib/locations/psgc-queries";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cityId = request.nextUrl.searchParams.get("cityId");
  if (!cityId) {
    return NextResponse.json({ error: "cityId is required" }, { status: 400 });
  }
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const barangays = await listBarangays(cityId, query);
  return NextResponse.json({ items: barangays });
}
