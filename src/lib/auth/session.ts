import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppRole, parseRole, ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";

const ROLE_COOKIE_KEY = "tara_role";
const USER_COOKIE_KEY = "tara_uid";

export interface AuthSession {
  userId: string;
  role: AppRole;
}

export async function getCurrentRole(): Promise<AppRole | null> {
  const store = await cookies();
  const rawRole = store.get(ROLE_COOKIE_KEY)?.value ?? "";
  return parseRole(rawRole);
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  const store = await cookies();
  const userId = store.get(USER_COOKIE_KEY)?.value ?? "";
  const role = parseRole(store.get(ROLE_COOKIE_KEY)?.value ?? "");

  if (!userId || !role) {
    return null;
  }

  return { userId, role };
}

export async function requireRole(allowedRoles: AppRole[]) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  if (!allowedRoles.includes(session.role)) {
    redirect(ROLE_DASHBOARD_PATH[session.role]);
  }
  return session.role;
}

export const SESSION_KEYS = {
  userId: USER_COOKIE_KEY,
  role: ROLE_COOKIE_KEY,
};
