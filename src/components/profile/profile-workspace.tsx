import Link from "next/link";
import { DietaryPref, Gender, Prisma } from "@prisma/client";
import { saveProfile } from "@/app/actions/profile-actions";
import { TimedToast } from "@/components/ui/timed-toast";
import { ROLE_DASHBOARD_PATH, type AppRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { SurfaceCard } from "@/components/ui/page-shell";

type ProfileWorkspaceProps = {
  userId: string;
  role: AppRole;
  error?: string;
  message?: string;
  backHref?: string;
  embedded?: boolean;
};

const LIFESTYLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "athlete", label: "Athlete" },
  { value: "office_worker", label: "Office worker" },
];

const DIETARY_OPTIONS: Array<{ value: DietaryPref; label: string }> = [
  { value: "VEGETARIAN", label: "Vegetarian" },
  { value: "VEGAN", label: "Vegan" },
  { value: "GLUTEN_FREE", label: "Gluten-free" },
];

const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "NON_BINARY", label: "Non-binary" },
  { value: "PREFER_NOT_SAY", label: "Prefer not to say" },
];

type ConsumptionHabits = {
  coffeeDrinker?: boolean;
  snackConsumer?: boolean;
  energyDrinkConsumer?: boolean;
  snacks?: string;
};

export async function ProfileWorkspace({
  userId,
  role,
  error,
  message,
  backHref,
  embedded = false,
}: ProfileWorkspaceProps) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      organization: true,
      createdAt: true,
    },
  });
  if (!user) {
    return null;
  }

  const panelist = await prisma.panelist.findFirst({
    where: {
      OR: [{ userId: user.id }, { email: user.email }],
    },
    select: {
      id: true,
      age: true,
      gender: true,
      location: true,
      occupation: true,
      lifestyle: true,
      dietaryPrefs: true,
      consumptionHabits: true,
      joinedAt: true,
      lastActive: true,
    },
  });

  const participationHistory = panelist
    ? await prisma.studyParticipant.findMany({
        where: { panelistId: panelist.id },
        include: {
          study: {
            select: {
              id: true,
              title: true,
              productName: true,
              stage: true,
            },
          },
        },
        orderBy: { selectionOrder: "desc" },
        take: 20,
      })
    : [];

  const habits = parseConsumption(panelist?.consumptionHabits ?? null);
  const selectedLifestyle = new Set(panelist?.lifestyle ?? []);
  const selectedDietary = new Set(panelist?.dietaryPrefs ?? []);
  const redirectTo = embedded ? `${ROLE_DASHBOARD_PATH[role]}?view=profile` : "/profile";

  return (
    <>
      <SurfaceCard className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#8d735f]">Panelist Management</p>
          <h1 className="mt-1 text-3xl font-bold text-[#2f241d]">My Profile</h1>
          <p className="mt-1 text-[#6f5b4f]">Maintain your panelist data for better matching in future studies.</p>
        </div>
        {backHref && (
          <Link href={backHref} className="app-button-secondary inline-flex items-center justify-center px-4 py-2">
            Back to Dashboard
          </Link>
        )}
      </SurfaceCard>

      <TimedToast
        title={error ? "Profile Error" : "Profile Updated"}
        message={error ? decodeURIComponent(error) : message ? decodeURIComponent(message) : undefined}
        variant={error ? "error" : "success"}
        durationMs={3000}
      />

      <SurfaceCard>
        <form action={saveProfile} className="space-y-8">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-[#2f241d]">Basic Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Full Name">
                <input name="name" defaultValue={user.name} className="app-input" required />
              </Field>

              <Field label="Email (Read-only)">
                <input value={user.email} className="app-input bg-[#f5ede6]" disabled />
              </Field>

              <Field label="Organization">
                <input name="organization" defaultValue={user.organization ?? ""} className="app-input" />
              </Field>

              <Field label="Age">
                <input type="number" name="age" min={10} max={100} defaultValue={panelist?.age ?? 25} className="app-input" required />
              </Field>

              <Field label="Gender">
                <select name="gender" defaultValue={panelist?.gender ?? "PREFER_NOT_SAY"} className="app-select">
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Location">
                <input name="location" defaultValue={panelist?.location ?? "Unspecified"} className="app-input" required />
              </Field>

              <Field label="Occupation">
                <input name="occupation" defaultValue={panelist?.occupation ?? "Consumer"} className="app-input" required />
              </Field>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-[#2f241d]">Lifestyle Attributes</h2>
            <div className="grid md:grid-cols-3 gap-3">
              {LIFESTYLE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 rounded-lg border border-[#e7ddd4] bg-[#fffaf4] p-3 text-sm">
                  <input type="checkbox" name="lifestyle" value={option.value} defaultChecked={selectedLifestyle.has(option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-[#2f241d]">Dietary Information</h2>
            <div className="grid md:grid-cols-3 gap-3">
              {DIETARY_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 rounded-lg border border-[#e7ddd4] bg-[#fffaf4] p-3 text-sm">
                  <input type="checkbox" name="dietaryPrefs" value={option.value} defaultChecked={selectedDietary.has(option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-[#2f241d]">Consumption Behavior</h2>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-[#e7ddd4] bg-[#fffaf4] p-3 text-sm">
                <input type="checkbox" name="coffeeDrinker" defaultChecked={habits.coffeeDrinker} />
                Coffee drinker
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[#e7ddd4] bg-[#fffaf4] p-3 text-sm">
                <input type="checkbox" name="snackConsumer" defaultChecked={habits.snackConsumer} />
                Snack consumer
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[#e7ddd4] bg-[#fffaf4] p-3 text-sm">
                <input type="checkbox" name="energyDrinkConsumer" defaultChecked={habits.energyDrinkConsumer} />
                Energy drink consumer
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" className="app-button-primary inline-flex items-center justify-center px-5 py-2.5">
              Save Profile
            </button>
          </div>
        </form>
      </SurfaceCard>

      <SurfaceCard className="space-y-4">
        <h2 className="text-xl font-semibold text-[#2f241d]">Participation History</h2>
        <p className="text-sm text-[#6f5b4f]">
          Previous participation records are used to improve participant matching for future studies.
        </p>

        {participationHistory.length === 0 && (
          <p className="rounded-lg border border-dashed border-[#d9ccbf] p-4 text-sm text-[#6f5b4f]">No participation records yet.</p>
        )}

        {participationHistory.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-[#e7ddd4]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-[#faf4ee]">
                <tr>
                  <th className="px-4 py-2 text-left">Study</th>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-4 py-2 text-left">Stage</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Completed</th>
                </tr>
              </thead>
              <tbody>
                {participationHistory.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-4 py-2">{row.study.title}</td>
                    <td className="px-4 py-2">{row.study.productName}</td>
                    <td className="px-4 py-2">{row.study.stage}</td>
                    <td className="px-4 py-2">{row.status}</td>
                    <td className="px-4 py-2">{row.completedAt ? new Date(row.completedAt).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard className="text-sm text-[#6f5b4f]">
        <p>
          Account Role: <span className="font-medium text-[#2f241d]">{user.role}</span>
        </p>
        <p className="mt-1">
          Joined: <span className="font-medium text-[#2f241d]">{new Date(user.createdAt).toLocaleDateString()}</span>
        </p>
        {panelist && (
          <>
            <p className="mt-1">
              Panelist profile created:{" "}
              <span className="font-medium text-[#2f241d]">{new Date(panelist.joinedAt).toLocaleDateString()}</span>
            </p>
            <p className="mt-1">
              Last active: <span className="font-medium text-[#2f241d]">{new Date(panelist.lastActive).toLocaleString()}</span>
            </p>
          </>
        )}
      </SurfaceCard>
    </>
  );
}

function parseConsumption(value: Prisma.JsonValue | null): ConsumptionHabits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      coffeeDrinker: false,
      snackConsumer: false,
      energyDrinkConsumer: false,
    };
  }

  const record = value as Record<string, unknown>;
  const snackFlag =
    typeof record.snackConsumer === "boolean"
      ? record.snackConsumer
      : typeof record.snacks === "string"
        ? record.snacks === "daily" || record.snacks === "weekly"
        : false;

  return {
    coffeeDrinker: record.coffeeDrinker === true,
    snackConsumer: snackFlag,
    energyDrinkConsumer: record.energyDrinkConsumer === true,
    snacks: typeof record.snacks === "string" ? record.snacks : undefined,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium text-[#5d493b]">{label}</span>
      {children}
    </label>
  );
}
