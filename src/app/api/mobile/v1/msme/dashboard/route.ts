import { NextRequest } from "next/server";
import { getMsmeDashboardData } from "@/lib/mobile/msme";
import { mobileJson, requireMobileUser } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request, ["MSME", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const data = await getMsmeDashboardData(auth.user.id, query);
  return mobileJson(data);
}
