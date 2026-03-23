import { redirect } from "next/navigation";
import { getCurrentRole } from "@/lib/auth/session";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";

export default async function DashboardGatewayPage() {
  const role = await getCurrentRole();
  if (!role) {
    redirect("/login");
  }
  redirect(ROLE_DASHBOARD_PATH[role]);
}
