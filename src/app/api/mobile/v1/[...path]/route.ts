import { mobileError } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

export function GET() {
  return mobileNotFound();
}

export function POST() {
  return mobileNotFound();
}

export function PATCH() {
  return mobileNotFound();
}

export function PUT() {
  return mobileNotFound();
}

export function DELETE() {
  return mobileNotFound();
}

function mobileNotFound() {
  return mobileError("Mobile API endpoint not found.", 404, "NOT_FOUND");
}
