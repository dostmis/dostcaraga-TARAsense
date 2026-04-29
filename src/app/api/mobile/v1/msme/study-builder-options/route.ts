import { NextRequest } from "next/server";
import { mobileJson, requireMobileUser } from "@/lib/mobile/api";
import { getStudyBuilderOptions } from "@/lib/mobile/study-builder-options";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request, ["MSME", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  return mobileJson(getStudyBuilderOptions());
}
