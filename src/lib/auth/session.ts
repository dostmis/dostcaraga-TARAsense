import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppRole, parseRole, ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { SESSION_TOKEN_COOKIE_KEY, verifySessionToken } from "@/lib/auth/session-token";

const ROLE_COOKIE_KEY = "tara_role";
const USER_COOKIE_KEY = "tara_uid";
const GUEST_PARTICIPANT_COOKIE_KEY = "tara_guest_pid";
const GUEST_STUDY_COOKIE_KEY = "tara_guest_sid";
const GUEST_CODE_COOKIE_KEY = "tara_guest_code";

export interface AuthSession {
  userId: string;
  role: AppRole;
}

export interface GuestSession {
  participantId: string;
  studyId: string;
  guestCode: string | null;
}

export async function getCurrentRole(): Promise<AppRole | null> {
  const session = await getCurrentSession();
  return session?.role ?? null;
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_TOKEN_COOKIE_KEY)?.value ?? "";
  const verified = verifySessionToken(token);
  if (!verified) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: verified.userId },
    select: { id: true, role: true },
  });

  if (!user) {
    return null;
  }

  const role = parseRole(user.role);
  if (!role) {
    return null;
  }

  return { userId: user.id, role };
}

export async function getCurrentGuestSession(): Promise<GuestSession | null> {
  const store = await cookies();
  const participantId = store.get(GUEST_PARTICIPANT_COOKIE_KEY)?.value ?? "";
  const studyId = store.get(GUEST_STUDY_COOKIE_KEY)?.value ?? "";
  const guestCode = store.get(GUEST_CODE_COOKIE_KEY)?.value ?? "";

  if (!participantId || !studyId) {
    return null;
  }

  return {
    participantId,
    studyId,
    guestCode: guestCode || null,
  };
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

export function applyGuestSessionCookies(
  store: Awaited<ReturnType<typeof cookies>>,
  input: { participantId: string; studyId: string; guestCode?: string | null; maxAge?: number }
) {
  const maxAge = input.maxAge ?? 60 * 60 * 8;

  store.set(GUEST_PARTICIPANT_COOKIE_KEY, input.participantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  store.set(GUEST_STUDY_COOKIE_KEY, input.studyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  store.set(GUEST_CODE_COOKIE_KEY, input.guestCode ?? "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export function clearGuestSessionCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete(GUEST_PARTICIPANT_COOKIE_KEY);
  store.delete(GUEST_STUDY_COOKIE_KEY);
  store.delete(GUEST_CODE_COOKIE_KEY);
}

export const SESSION_KEYS = {
  token: SESSION_TOKEN_COOKIE_KEY,
  userId: USER_COOKIE_KEY,
  role: ROLE_COOKIE_KEY,
  guestParticipantId: GUEST_PARTICIPANT_COOKIE_KEY,
  guestStudyId: GUEST_STUDY_COOKIE_KEY,
  guestCode: GUEST_CODE_COOKIE_KEY,
};
