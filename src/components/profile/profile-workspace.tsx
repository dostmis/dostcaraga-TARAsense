import { Gender } from "@prisma/client";
import { saveProfile } from "@/app/actions/profile-actions";
import { saveFicFacilityProfile } from "@/app/actions/auth-actions";
import { getUserLocationLabels } from "@/app/actions/location-actions";
import { AppBackButton } from "@/components/ui/app-back-button";
import { TimedToast } from "@/components/ui/timed-toast";
import { ROLE_DASHBOARD_PATH, ROLE_LABEL, type AppRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { SurfaceCard } from "@/components/ui/page-shell";
import { ProfileLocationSection } from "@/components/profile/profile-location-section";
import { FicFacilityForm } from "@/components/profile/fic-facility-form";
import { buildFicFacilityFormInitial } from "@/lib/fic-facility-view";
import {
  TARGET_CONSUMER_DIETARY_OPTIONS,
  TARGET_CONSUMER_FOOD_CONSUMPTION_OPTIONS,
  TARGET_CONSUMER_HEALTH_FITNESS_OPTIONS,
  TARGET_CONSUMER_WORK_DAILY_LIVING_OPTIONS,
} from "@/lib/target-consumer";

type ProfileWorkspaceProps = {
  userId: string;
  role: AppRole;
  error?: string;
  message?: string;
  backHref?: string;
  embedded?: boolean;
};

const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "NON_BINARY", label: "Non-binary" },
  { value: "PREFER_NOT_SAY", label: "Prefer not to say" },
];

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
      assignedRegion: true,
      assignedFacility: true,
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
      workDailyLiving: true,
      healthFitness: true,
      foodConsumption: true,
      dietaryPrefs: true,
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

  const selectedWorkDailyLiving = new Set(panelist?.workDailyLiving ?? []);
  const selectedHealthFitness = new Set(panelist?.healthFitness ?? []);
  const selectedFoodConsumption = new Set(panelist?.foodConsumption ?? []);
  const selectedDietary = new Set<string>(panelist?.dietaryPrefs ?? []);
  const redirectTo = embedded ? `${ROLE_DASHBOARD_PATH[role]}?view=profile` : "/profile";

  const locationProfile = await getUserLocationLabels(user.id);

  const ficFacilityProfile =
    role === "FIC"
      ? await prisma.ficFacilityProfile.findUnique({
          where: { userId: user.id },
          select: {
            id: true,
            facilityName: true,
            institutionName: true,
            regionId: true,
            provinceId: true,
            cityId: true,
            physicalAddress: true,
            website: true,
            directorName: true,
            position: true,
            officialEmail: true,
            contactNumber: true,
            facilityType: true,
            facilityTypeOther: true,
            sensoryCapabilities: true,
            govIdPath: true,
            status: true,
          },
        })
      : null;
  const ficFacilityInitial = ficFacilityProfile ? await buildFicFacilityFormInitial(ficFacilityProfile) : null;

  return (
    <>
      <SurfaceCard className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#8d735f]">Panelist Management</p>
          <h1 className="mt-1 text-3xl font-bold text-[#2f241d]">My Profile</h1>
          <p className="mt-1 text-[#6f5b4f]">Maintain your panelist data for better matching in future studies.</p>
        </div>
        {backHref && (
          <AppBackButton fallbackHref={backHref} label="Back to Dashboard" />
        )}
      </SurfaceCard>

      {/* When embedded in a dashboard, the parent already renders a single
          "System Message" toast for the same error/message query params.
          Only render our own toast on the standalone /profile page. */}
      {!embedded && (
        <TimedToast
          title={error ? "Profile Error" : "Profile Updated"}
          message={error ? decodeURIComponent(error) : message ? decodeURIComponent(message) : undefined}
          variant={error ? "error" : "success"}
          durationMs={3000}
        />
      )}

      <SurfaceCard>
        <ProfileLocationSection
          initialValue={
            locationProfile?.value ?? {
              regionId: null,
              provinceId: null,
              cityId: null,
              barangayId: null,
            }
          }
          initialLabels={locationProfile?.labels ?? {}}
          initialAddressDetails={locationProfile?.addressDetails ?? null}
          completedAt={locationProfile?.completedAt ?? null}
        />
      </SurfaceCard>

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

              {role === "FIC" && (
                <>
                  <Field label="Assigned Region (Admin Managed)">
                    <input value={user.assignedRegion ?? "Not assigned yet"} className="app-input bg-[#f5ede6]" disabled />
                  </Field>

                  <Field label="Assigned Facility (Admin Managed)">
                    <input value={user.assignedFacility ?? "Not assigned yet"} className="app-input bg-[#f5ede6]" disabled />
                  </Field>
                </>
              )}

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
            </div>
          </div>

          {role !== "FIC" && (
            <>
              <CategorySection
                title="Dietary Information"
                name="dietaryPrefs"
                options={TARGET_CONSUMER_DIETARY_OPTIONS}
                selected={selectedDietary}
              />

              <CategorySection
                title="Work & Daily Living"
                name="workDailyLiving"
                options={TARGET_CONSUMER_WORK_DAILY_LIVING_OPTIONS}
                selected={selectedWorkDailyLiving}
              />

              <CategorySection
                title="Health & Fitness"
                name="healthFitness"
                options={TARGET_CONSUMER_HEALTH_FITNESS_OPTIONS}
                selected={selectedHealthFitness}
              />

              <CategorySection
                title="Food & Consumption Behavior"
                name="foodConsumption"
                options={TARGET_CONSUMER_FOOD_CONSUMPTION_OPTIONS}
                selected={selectedFoodConsumption}
              />
            </>
          )}

          <div className="flex justify-end">
            <button type="submit" className="app-button-primary inline-flex items-center justify-center px-5 py-2.5">
              Save Profile
            </button>
          </div>
        </form>
      </SurfaceCard>

      {role === "FIC" && (
        <SurfaceCard className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-[#2f241d]">Facility Information</h2>
            <p className="mt-1 text-sm text-[#6f5b4f]">
              Keep your facility details current. Your DOST region and facility assignment is managed by an admin and
              shown read-only above.
            </p>
            {ficFacilityProfile?.status ? (
              <p className="mt-1 text-xs uppercase tracking-wide text-[#8d735f]">
                Application status: {ficFacilityProfile.status}
              </p>
            ) : null}
          </div>
          <FicFacilityForm
            action={saveFicFacilityProfile}
            redirectTo={redirectTo}
            submitLabel="Save Facility Profile"
            initial={ficFacilityInitial}
          />
        </SurfaceCard>
      )}

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
          Account Role: <span className="font-medium text-[#2f241d]">{ROLE_LABEL[role]}</span>
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

function CategorySection({
  title,
  name,
  options,
  selected,
}: {
  title: string;
  name: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: Set<string>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-[#2f241d]">{title}</h2>
        <p className="text-xs italic text-[#8d735f]">Check all that applies</p>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 rounded-lg border border-[#e7ddd4] bg-[#fffaf4] p-3 text-sm">
            <input type="checkbox" name={name} value={option.value} defaultChecked={selected.has(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium text-[#5d493b]">{label}</span>
      {children}
    </label>
  );
}
