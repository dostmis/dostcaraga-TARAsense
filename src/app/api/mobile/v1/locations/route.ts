import { NextRequest } from "next/server";
import { mobileError, mobileJson, requireMobileUser } from "@/lib/mobile/api";
import {
  listBarangays,
  listCities,
  listProvinces,
  listRegions,
} from "@/lib/locations/psgc-queries";

export const dynamic = "force-dynamic";

/**
 * Unified mobile PSGC cascade endpoint.
 *
 *   GET /api/mobile/v1/locations?level=region
 *   GET /api/mobile/v1/locations?level=province&parentId=<regionId>
 *   GET /api/mobile/v1/locations?level=city&parentId=<provinceId>
 *   GET /api/mobile/v1/locations?level=barangay&parentId=<cityId>
 *   Optional `?q=<search>`
 */
export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const level = request.nextUrl.searchParams.get("level");
  const parentId = request.nextUrl.searchParams.get("parentId") ?? "";
  const query = request.nextUrl.searchParams.get("q") ?? undefined;

  switch (level) {
    case "region":
      return mobileJson({ items: await listRegions(query) });
    case "province":
      if (!parentId) return mobileError("parentId (regionId) is required", 400, "MISSING_PARENT");
      return mobileJson({ items: await listProvinces(parentId, query) });
    case "city":
      if (!parentId) return mobileError("parentId (provinceId) is required", 400, "MISSING_PARENT");
      return mobileJson({ items: await listCities(parentId, query) });
    case "barangay":
      if (!parentId) return mobileError("parentId (cityId) is required", 400, "MISSING_PARENT");
      return mobileJson({ items: await listBarangays(parentId, query) });
    default:
      return mobileError("level must be one of region, province, city, barangay", 400, "INVALID_LEVEL");
  }
}
