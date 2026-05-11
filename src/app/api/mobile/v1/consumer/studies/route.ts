import { NextRequest } from "next/server";
import { mobileJson, requireMobileUser } from "@/lib/mobile/api";
import { getConsumerAvailableStudies } from "@/lib/mobile/consumer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request, ["CONSUMER"]);
  if ("response" in auth) {
    return auth.response;
  }

  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  return mobileJson(await getConsumerAvailableStudies(auth.user.id, query, limit));
}

function parseLimit(value: string | null) {
  if (!value) {
    return 20;
  }

  const limit = Number(value);
  if (!Number.isFinite(limit)) {
    return 20;
  }

  return Math.max(1, Math.min(Math.floor(limit), 50));
}
