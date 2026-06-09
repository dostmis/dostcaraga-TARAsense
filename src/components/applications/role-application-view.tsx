import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  Crown,
  FlaskConical,
  ListChecks,
  Search,
  SendHorizonal,
  ShieldCheck,
  Store,
  type LucideIcon,
} from "lucide-react";
import { applyForFicRole, applyForRole } from "@/app/actions/auth-actions";
import { FicFacilityForm, type FicFacilityFormInitial } from "@/components/profile/fic-facility-form";

type ApplicationRow = {
  id: string;
  targetRole: string;
  status: string;
  reason: string | null;
  createdAt: Date;
};

type RoleApplicationViewProps = {
  applyMode: "msme" | "fic" | null;
  applications: ApplicationRow[];
  ficFormInitial: FicFacilityFormInitial | null;
  hasPendingMsmeRequest: boolean;
  hasPendingFicRequest: boolean;
};

const BASE_PATH = "/consumer/dashboard?view=applications";
const MSME_APPLY_PATH = `${BASE_PATH}&apply=msme`;
const FIC_APPLY_PATH = `${BASE_PATH}&apply=fic`;

const PROCESS_STEPS: Array<{ icon: LucideIcon; step: string; title: string; description: string; highlight?: boolean }> = [
  { icon: SendHorizonal, step: "Step 1", title: "Submit Application", description: "Fill out the application form and upload requirements." },
  { icon: Search, step: "Step 2", title: "Under Review", description: "Our team will review your application." },
  { icon: Bell, step: "Step 3", title: "Get Notified", description: "You'll be notified once a decision is made." },
  { icon: Crown, step: "Step 4", title: "Access Your Role", description: "Once approved, enjoy role-specific features.", highlight: true },
];

export function RoleApplicationView({
  applyMode,
  applications,
  ficFormInitial,
  hasPendingMsmeRequest,
  hasPendingFicRequest,
}: RoleApplicationViewProps) {
  if (applyMode === "msme") {
    return <MsmeApplyScreen hasPendingMsmeRequest={hasPendingMsmeRequest} />;
  }
  if (applyMode === "fic") {
    return <FicApplyScreen ficFormInitial={ficFormInitial} hasPendingFicRequest={hasPendingFicRequest} />;
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="Role Application"
        subtitle="Apply for a role that best matches your organization or business. After submission, our team will review your application and notify you of the result."
      />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#64748b]">Choose a role to apply for</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <RoleCard
            accent="emerald"
            icon={Store}
            title="MSME"
            tagline="Micro, Small, and Medium Enterprise"
            description="For businesses engaged in food production, processing, or related services that meet the criteria for MSME."
            bullets={["Operate a registered business", "Are involved in food-related products or services", "Want to access MSME-exclusive resources and opportunities"]}
            applyHref={MSME_APPLY_PATH}
            applyLabel="Apply as MSME"
            pending={hasPendingMsmeRequest}
          />
          <RoleCard
            accent="blue"
            icon={FlaskConical}
            title="FIC"
            tagline="Food Innovation Center"
            description="For organizations with facilities and capabilities in food innovation, research, development, or testing."
            bullets={["Operate a facility for food innovation or research", "Provide testing, development, or technical services", "Want to be part of the FIC network and collaborations"]}
            applyHref={FIC_APPLY_PATH}
            applyLabel="Apply as FIC"
            pending={hasPendingFicRequest}
          />
        </div>
      </section>

      <ProcessSection />

      <ApplicationHistory applications={applications} />

      <p className="flex items-center justify-center gap-2 pt-1 text-xs text-[#64748b]">
        <ShieldCheck size={14} className="text-emerald-600" />
        Your information is secure with us. TARAsense is committed to protecting your data.
      </p>
    </div>
  );
}

/* ---------------------------------- Cards ---------------------------------- */

type Accent = "emerald" | "blue";

const ACCENT_STYLES: Record<
  Accent,
  { bar: string; chip: string; title: string; tagline: string; bullet: string; button: string }
> = {
  emerald: {
    bar: "bg-emerald-600",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    title: "text-emerald-700",
    tagline: "text-emerald-600",
    bullet: "text-emerald-600",
    button: "bg-emerald-600 hover:bg-emerald-700",
  },
  blue: {
    bar: "bg-blue-600",
    chip: "border-blue-200 bg-blue-50 text-blue-700",
    title: "text-blue-700",
    tagline: "text-blue-600",
    bullet: "text-blue-600",
    button: "bg-blue-600 hover:bg-blue-700",
  },
};

function RoleCard({
  accent,
  icon: Icon,
  title,
  tagline,
  description,
  bullets,
  applyHref,
  applyLabel,
  pending,
}: {
  accent: Accent;
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  bullets: string[];
  applyHref: string;
  applyLabel: string;
  pending: boolean;
}) {
  const styles = ACCENT_STYLES[accent];
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_8px_28px_rgba(15,23,42,0.08)]">
      <div className={`h-1.5 ${styles.bar}`} />
      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${styles.chip}`}>
            <Icon size={20} />
          </span>
          <div>
            <h3 className={`text-xl font-bold leading-tight ${styles.title}`}>{title}</h3>
            <p className={`text-sm font-medium ${styles.tagline}`}>{tagline}</p>
          </div>
        </div>

        <p className="text-sm leading-6 text-[#334155]">{description}</p>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-[#0f172a]">You may apply if you:</p>
          <ul className="space-y-2">
            {bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2 text-sm text-[#334155]">
                <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${styles.bullet}`} />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto space-y-2 pt-2">
          {pending ? (
            <span className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700">
              <Search size={15} /> Application under review
            </span>
          ) : (
            <Link
              href={applyHref}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors ${styles.button}`}
            >
              {applyLabel} <ArrowRight size={15} />
            </Link>
          )}
          <Link
            href={applyHref}
            className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-[#64748b] hover:text-[#334155]"
          >
            <ListChecks size={13} /> View requirements
          </Link>
        </div>
      </div>
    </article>
  );
}

/* -------------------------------- Process --------------------------------- */

function ProcessSection() {
  return (
    <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="mb-5 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#fed7aa] bg-[#ffedd5] text-[#c2410c]">
          <ListChecks size={16} />
        </span>
        <h2 className="text-base font-semibold text-[#0f172a]">What happens after you apply?</h2>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PROCESS_STEPS.map((step, index) => (
          <li key={step.title} className="relative flex flex-col items-center gap-2 text-center">
            <span
              className={`inline-flex h-12 w-12 items-center justify-center rounded-full border ${
                step.highlight
                  ? "border-[#fed7aa] bg-[#ffedd5] text-[#c2410c]"
                  : "border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]"
              }`}
            >
              <step.icon size={20} />
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">{step.step}</p>
            <p className="text-sm font-semibold text-[#0f172a]">{step.title}</p>
            <p className="text-xs leading-5 text-[#64748b]">{step.description}</p>
            {index < PROCESS_STEPS.length - 1 && (
              <ArrowRight size={16} className="absolute -right-2 top-3 hidden text-[#cbd5e1] xl:block" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ----------------------------- Status / history --------------------------- */

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "border-slate-200 bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function ApplicationHistory({ applications }: { applications: ApplicationRow[] }) {
  return (
    <section className="space-y-3 rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[#0f172a]">Application Status</h2>
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#94a3b8]">
          {applications.length} {applications.length === 1 ? "record" : "records"}
        </span>
      </div>

      {applications.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#64748b]">
          No role applications yet. Choose a role above to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {applications.map((application) => (
            <li key={application.id} className="rounded-xl border border-[#e2e8f0] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#0f172a]">{application.targetRole} access</p>
                <StatusBadge status={application.status} />
              </div>
              <p className="mt-1 text-xs text-[#94a3b8]">{new Date(application.createdAt).toLocaleString()}</p>
              {application.reason && <p className="mt-2 text-sm text-[#334155]">{application.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------ Apply screens ----------------------------- */

function MsmeApplyScreen({ hasPendingMsmeRequest }: { hasPendingMsmeRequest: boolean }) {
  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeading title="Apply as MSME" subtitle="Tell us why you'd like MSME access. Our team will review your request and notify you of the result." />

      <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <div className="h-1.5 bg-emerald-600" />
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
              <Store size={20} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-emerald-700">MSME Application</h3>
              <p className="text-sm text-[#64748b]">Micro, Small, and Medium Enterprise</p>
            </div>
          </div>

          {hasPendingMsmeRequest ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-700">
              <Search size={16} /> Your MSME application is pending admin review. You&apos;ll be notified once it&apos;s decided.
            </div>
          ) : (
            <form action={applyForRole} className="space-y-4">
              <input type="hidden" name="targetRole" value="MSME" />
              <label className="block space-y-1">
                <span className="text-sm font-medium text-[#334155]">Reason for MSME access (optional)</span>
                <textarea
                  name="reason"
                  placeholder="Briefly describe your business and why you need MSME access"
                  className="app-textarea min-h-28"
                />
              </label>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                Submit MSME Application <ArrowRight size={15} />
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function FicApplyScreen({
  ficFormInitial,
  hasPendingFicRequest,
}: {
  ficFormInitial: FicFacilityFormInitial | null;
  hasPendingFicRequest: boolean;
}) {
  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeading
        title="Apply as FIC"
        subtitle="Complete your facility application below. The DOST region and facility assignment is set by an admin upon approval."
      />

      <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <div className="h-1.5 bg-blue-600" />
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700">
              <FlaskConical size={20} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-blue-700">FIC Facility Application</h3>
              <p className="text-sm text-[#64748b]">Food Innovation Center</p>
            </div>
          </div>

          {hasPendingFicRequest ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-700">
              <Search size={16} /> Your FIC facility application is pending admin review. You&apos;ll be notified once it&apos;s decided.
            </div>
          ) : (
            <FicFacilityForm
              action={applyForFicRole}
              redirectTo={BASE_PATH}
              submitLabel={ficFormInitial ? "Resubmit FIC Application" : "Submit FIC Application"}
              initial={ficFormInitial}
            />
          )}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------- Helpers --------------------------------- */

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="border-b border-[#e2e8f0] pb-5">
      <p className="text-xs uppercase tracking-[0.18em] text-[#64748b]">Consumer Workspace</p>
      <h1 className="mt-1 text-2xl font-semibold leading-tight text-[#0f172a] sm:text-3xl">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[#64748b]">{subtitle}</p>
    </header>
  );
}

function BackLink() {
  return (
    <Link
      href={BASE_PATH}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-[#64748b] transition-colors hover:text-[#334155]"
    >
      <ArrowLeft size={15} /> Back to roles
    </Link>
  );
}
