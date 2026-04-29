import { NextRequest } from "next/server";
import { mobileJson, publicMobileUser, requireMobileUser } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  return mobileJson(publicMobileUser(auth.user));
}
