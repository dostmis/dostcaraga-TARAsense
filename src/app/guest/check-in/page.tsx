import Link from "next/link";
import { prisma } from "@/lib/db";
import { registerWalkInGuest } from "@/app/actions/guest-actions";
import { formatSessionWindow, parseStudySessionSchedule } from "@/lib/study-schedule";

type PageProps = {
  searchParams: Promise<{ studyId?: string; slotId?: string; error?: string; message?: string }>;
};

export default async function GuestCheckInPage({ searchParams }: PageProps) {
  const { studyId, slotId, error, message } = await searchParams;

  if (!studyId || !slotId) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8fafc] px-4">
        <section className="w-full max-w-lg rounded-2xl border border-[#e2e8f0] bg-white p-6 text-center">
          <h1 className="text-xl font-semibold text-[#0f172a]">Invalid walk-in link</h1>
          <p className="mt-2 text-sm text-[#64748b]">Ask the facilitator for the correct QR code.</p>
          <Link href="/" className="mt-4 inline-flex rounded-lg border border-[#e2e8f0] px-4 py-2 text-sm font-medium text-[#334155]">
            Return Home
          </Link>
        </section>
      </main>
    );
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      productName: true,
      status: true,
      targetDemographics: true,
      sensoryAttributes: { select: { id: true }, take: 1 },
    },
  });

  if (!study) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8fafc] px-4">
        <section className="w-full max-w-lg rounded-2xl border border-[#e2e8f0] bg-white p-6 text-center">
          <h1 className="text-xl font-semibold text-[#0f172a]">Study not found</h1>
          <p className="mt-2 text-sm text-[#64748b]">This QR code may no longer be valid.</p>
        </section>
      </main>
    );
  }

  const schedule = parseStudySessionSchedule(study.targetDemographics);
  const selectedSlot = schedule?.slots.find((slot) => slot.id === slotId) ?? null;
  const selectedStartDate = selectedSlot ? new Date(selectedSlot.startsAt) : null;
  const occupied = selectedStartDate
    ? await prisma.studyParticipant.count({
        where: {
          studyId: study.id,
          status: { notIn: ["CANCELLED", "DECLINED"] },
          OR: [{ requestedSessionAt: selectedStartDate }, { sessionAt: selectedStartDate }],
        },
      })
    : 0;

  const remaining = selectedSlot ? Math.max(selectedSlot.capacity - occupied, 0) : 0;
  const canCheckIn =
    Boolean(selectedSlot) &&
    ["RECRUITING", "ACTIVE"].includes(study.status) &&
    study.sensoryAttributes.length > 0 &&
    remaining > 0;

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-8">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <p className="text-xs uppercase tracking-[0.18em] text-[#ea580c]">Walk-in Guest Check-In</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#0f172a]">{study.title}</h1>
        <p className="mt-1 text-sm text-[#64748b]">{study.productName}</p>

        {selectedSlot && schedule && (
          <div className="mt-4 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm">
            <p className="font-medium text-[#0f172a]">{formatSessionWindow(selectedSlot, schedule.timezone)}</p>
            <p className="mt-1 text-[#64748b]">
              Capacity: {selectedSlot.capacity} | Occupied: {occupied} | Remaining: {remaining}
            </p>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{decodeURIComponent(error)}</p>}
        {message && (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{decodeURIComponent(message)}</p>
        )}

        {!selectedSlot && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            This session slot is invalid or expired. Please ask for the latest QR.
          </p>
        )}
        {selectedSlot && remaining <= 0 && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This session is already full. Please ask staff for another available slot.
          </p>
        )}
        {selectedSlot && !["RECRUITING", "ACTIVE"].includes(study.status) && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This study is currently closed for participation.
          </p>
        )}
        {selectedSlot && study.sensoryAttributes.length === 0 && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The study questionnaire is not configured yet.
          </p>
        )}

        {canCheckIn && (
          <form action={registerWalkInGuest} className="mt-6 space-y-4">
            <input type="hidden" name="studyId" value={study.id} />
            <input type="hidden" name="slotId" value={slotId} />

            <label className="block text-sm text-[#334155]">
              Full Name
              <input name="name" required className="app-input mt-1" placeholder="Enter full name" />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-[#334155]">
                Gender
                <select name="gender" required className="app-select mt-1">
                  <option value="">Select gender</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="NON_BINARY">Non-binary</option>
                  <option value="PREFER_NOT_SAY">Prefer not to say</option>
                </select>
              </label>
              <label className="block text-sm text-[#334155]">
                Age
                <input name="age" type="number" min={10} max={100} required className="app-input mt-1" placeholder="e.g. 24" />
              </label>
            </div>

            <label className="block text-sm text-[#334155]">
              Address
              <input name="address" required className="app-input mt-1" placeholder="City / Region / Address" />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-[#334155]">
                Organization
                <input name="organization" required className="app-input mt-1" placeholder="Company/School or N/A" />
              </label>
              <label className="block text-sm text-[#334155]">
                Occupation
                <input name="occupation" required className="app-input mt-1" placeholder="e.g. Student" />
              </label>
            </div>

            <button type="submit" className="app-button-primary w-full py-2.5">
              Continue to Consent
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

