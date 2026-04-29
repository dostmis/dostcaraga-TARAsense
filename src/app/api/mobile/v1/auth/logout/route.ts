import { NextRequest } from "next/server";
import { mobileJson, requireMobileUser } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  return mobileJson({ ok: true });
}
