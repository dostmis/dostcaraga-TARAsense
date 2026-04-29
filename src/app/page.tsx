import { redirect } from "next/navigation";
import { TarasenseLanding } from "@/components/landing/tarasense-landing";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";

export default async function LandingPage() {
  const currentRole = await getCurrentRole();
  if (currentRole) {
    redirect(ROLE_DASHBOARD_PATH[currentRole]);
  }

  return <TarasenseLanding />;
}
