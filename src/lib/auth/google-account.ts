import { prisma } from "@/lib/db";
import { AppRole, parseRole } from "@/lib/auth/roles";

/** The fields from a verified Google profile we need to link or create a user. */
export type GoogleProfileInput = {
  email: string;
  name: string | null;
  picture: string | null;
};

export type ResolvedGoogleUser = {
  userId: string;
  /** Effective role for dashboard routing (FIC_MANAGER→FIC, RESEARCHER→CONSUMER). */
  role: AppRole;
  /** Stored role string, preserved exactly as-is in the database. */
  storedRole: string;
  isNewUser: boolean;
  name: string;
  email: string;
};

export type FindGoogleUserResult =
  | { status: "found"; user: ResolvedGoogleUser }
  | { status: "not-found" }
  | { status: "invalid-role" };

/**
 * Look up an existing TARAsense user for a Google profile, matching strictly by
 * lowercased email so we never create a duplicate account. Existing users keep
 * their role, assignment, and profile untouched — we only backfill safe display
 * fields (name/image) when they are missing.
 *
 * Returns "not-found" when no account exists yet (caller decides whether to
 * create one), or "invalid-role" for an unrecoverable stored-role problem.
 */
export async function findLinkableGoogleUser(info: GoogleProfileInput): Promise<FindGoogleUserResult> {
  const email = info.email.trim().toLowerCase();
  if (!email) {
    return { status: "not-found" };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, name: true, image: true },
  });

  if (!existing) {
    return { status: "not-found" };
  }

  const role = parseRole(existing.role);
  if (!role) {
    // Unknown/unsupported stored role — refuse rather than guess.
    return { status: "invalid-role" };
  }

  // Backfill only safe, missing display fields. Never overwrite role,
  // assignedRegion/Facility, provider, or any existing value.
  const updates: { name?: string; image?: string } = {};
  if (!existing.name?.trim() && info.name) {
    updates.name = info.name;
  }
  if (!existing.image && info.picture) {
    updates.image = info.picture;
  }
  if (Object.keys(updates).length > 0) {
    await prisma.user.update({ where: { id: existing.id }, data: updates });
  }

  return {
    status: "found",
    user: {
      userId: existing.id,
      role,
      storedRole: existing.role,
      isNewUser: false,
      name: updates.name ?? existing.name,
      email,
    },
  };
}

/**
 * Create a brand-new Google account: CONSUMER role, no password (Google-only),
 * provider = google, plus a default Panelist record — mirroring the default
 * `register()` flow so the user can immediately participate in studies.
 *
 * If the email already exists (e.g. a race between confirmation clicks), this
 * links to the existing account instead of creating a duplicate.
 */
export async function createGoogleUser(profile: GoogleProfileInput): Promise<ResolvedGoogleUser | null> {
  const email = profile.email.trim().toLowerCase();
  if (!email) {
    return null;
  }

  // Guard against a duplicate if the account was created between checks.
  const existing = await findLinkableGoogleUser(profile);
  if (existing.status === "found") {
    return existing.user;
  }
  if (existing.status === "invalid-role") {
    return null;
  }

  const name = deriveDisplayName(profile.name, email);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        password: null,
        role: "CONSUMER",
        image: profile.picture,
        provider: "google",
      },
      select: { id: true, name: true },
    });

    const panelistData = {
      userId: user.id,
      name,
      email,
      age: 25,
      gender: "PREFER_NOT_SAY" as const,
      location: "Unspecified",
      occupation: "Consumer",
      lifestyle: [] as string[],
      dietaryPrefs: [],
      consumptionHabits: {
        coffeeDrinker: false,
        snackConsumer: false,
        energyDrinkConsumer: false,
        snacks: "weekly",
      },
      isActive: true,
    };

    const existingPanelist = await tx.panelist.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingPanelist) {
      await tx.panelist.update({ where: { id: existingPanelist.id }, data: panelistData });
    } else {
      await tx.panelist.create({ data: panelistData });
    }

    return user;
  });

  return {
    userId: created.id,
    role: "CONSUMER",
    storedRole: "CONSUMER",
    isNewUser: true,
    name: created.name,
    email,
  };
}

/**
 * Google sometimes omits the display name (e.g. single-word or restricted
 * profiles). Fall back to the email local-part, then a generic label, while
 * satisfying the User.name "min 2 chars" expectation used elsewhere.
 */
function deriveDisplayName(name: string | null, email: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length >= 2) {
    return trimmed;
  }
  const local = (email.split("@")[0] ?? "").trim();
  if (local.length >= 2) {
    return local;
  }
  return "TARAsense User";
}
