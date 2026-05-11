import { NextRequest } from "next/server";
import { getFicStudies } from "@/lib/mobile/fic";
import { mobileJson, requireMobileUser } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request, ["FIC", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  return mobileJson(await getFicStudies(auth.user, query, limit));
}

function parseLimit(value: string | null) {
  if (!value) {
    return 50;
  }

  const limit = Number(value);
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(Math.floor(limit), 100));
}
