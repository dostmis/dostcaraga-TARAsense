import { NextRequest, NextResponse } from "next/server";
import { listCities } from "@/lib/locations/psgc-queries";
import { getCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const provinceId = request.nextUrl.searchParams.get("provinceId");
  if (!provinceId) {
    return NextResponse.json({ error: "provinceId is required" }, { status: 400 });
  }
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const cities = await listCities(provinceId, query);
  return NextResponse.json({ items: cities });
}
