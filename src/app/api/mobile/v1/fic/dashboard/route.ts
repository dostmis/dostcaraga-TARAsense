import { NextRequest } from "next/server";
import { getFicDashboardData } from "@/lib/mobile/fic";
import { mobileJson, requireMobileUser } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request, ["FIC", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  return mobileJson(await getFicDashboardData(auth.user, query));
}
