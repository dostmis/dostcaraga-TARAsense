import Link from "next/link";
import {
  ArrowRight,
  Beaker,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Globe,
  Lightbulb,
  LineChart,
  Shield,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";

const roles = [
  {
    title: "MSME",
    desc: "Create studies, test products, and analyze results to improve food innovations.",
    href: "/msme/dashboard",
    icon: FlaskConical,
    className: "bg-blue-50 text-blue-600",
  },
  {
    title: "Consumer",
    desc: "Join sensory studies, share preferences, and help shape better products.",
    href: "/consumer/dashboard",
    icon: Users,
    className: "bg-orange-50 text-orange-600",
  },
  {
    title: "FIC",
    desc: "Coordinate sessions, monitor queues, and keep study operations smooth.",
    href: "/fic/dashboard",
    icon: UserCheck,
    className: "bg-emerald-50 text-emerald-600",
  },
  {
    title: "Admin",
    desc: "Manage approvals, monitor platform health, and oversee all workspaces.",
    href: "/admin/dashboard",
    icon: Shield,
    className: "bg-violet-50 text-violet-600",
  },
];

const steps = [
  { icon: ClipboardList, title: "Create Study", desc: "Configure sensory or market tests with guided setup." },
  { icon: Users, title: "Recruit Participants", desc: "Invite the right consumers for each study objective." },
  { icon: FlaskConical, title: "Run Sessions", desc: "Execute evaluations with scheduling and sample code flow." },
  { icon: LineChart, title: "Analyze", desc: "Review charts, AI interpretation, and decision-ready insights." },
  { icon: Lightbulb, title: "Refine Product", desc: "Turn feedback into clear formulation next steps." },
];

const trustItems = [
  { icon: Shield, title: "Secure and Private", desc: "Role-based access and controlled study visibility." },
  { icon: Globe, title: "Standards-Aligned", desc: "Built for sensory and consumer research workflows." },
  { icon: Zap, title: "Faster Decisions", desc: "Move from data collection to action without spreadsheet chaos." },
  { icon: CheckCircle2, title: "MSME Ready", desc: "Designed for practical, real-world product development." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <header className="sticky top-0 z-50 border-b border-[#e2e8f0] bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 md:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f97316]">
              <Beaker className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              TARA<span className="text-[#f97316]">sense</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-[#334155] hover:bg-[#f8fafc]">
              Log in
            </Link>
            <Link href="/register" className="rounded-lg border border-[#ea580c] bg-[#f97316] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea580c]">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-[#fed7aa] bg-[#fff7ed]">
        <div className="mx-auto w-full max-w-7xl px-4 py-20 text-center md:px-6 lg:px-8 lg:py-28">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ffedd5] px-4 py-1.5 text-sm font-medium text-[#ea580c]">
            <Beaker className="h-4 w-4" />
            Food Innovation Platform
          </div>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-bold tracking-tight text-[#0f172a] md:text-5xl lg:text-6xl">
            Test. Analyze. <span className="text-[#f97316]">Refine.</span> Advance.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-[#64748b]">
            TARAsense connects MSMEs, consumers, FIC teams, and admins in one workflow to run better studies and build products people actually want.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex items-center rounded-lg border border-[#ea580c] bg-[#f97316] px-5 py-2.5 font-semibold text-white hover:bg-[#ea580c]">
              Start Your First Study <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="/login" className="rounded-lg border border-[#e2e8f0] bg-white px-5 py-2.5 font-semibold text-[#0f172a] hover:bg-[#f8fafc]">
              Log in to Dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 md:px-6 lg:px-8 lg:py-20">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0f172a]">How TARAsense Works</h2>
          <p className="mx-auto mt-3 max-w-2xl text-[#64748b]">
            A clear end-to-end process from study setup to product decisions.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step) => (
            <article key={step.title} className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#fff7ed] text-[#f97316]">
                <step.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-[#0f172a]">{step.title}</h3>
              <p className="mt-2 text-sm text-[#64748b]">{step.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#f8fafc] py-16 lg:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6 lg:px-8">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[#0f172a]">Built for Every Role</h2>
            <p className="mx-auto mt-3 max-w-2xl text-[#64748b]">
              Consistent UX foundation with role-specific actions and insights.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map((role) => (
              <Link
                key={role.title}
                href={role.href}
                className="group rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all hover:border-[#fdba74] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
              >
                <div className={`inline-flex rounded-lg p-2.5 ${role.className}`}>
                  <role.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[#0f172a] group-hover:text-[#ea580c]">{role.title}</h3>
                <p className="mt-2 text-sm text-[#64748b]">{role.desc}</p>
                <span className="mt-3 inline-flex items-center text-sm font-medium text-[#f97316]">
                  Explore <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 md:px-6 lg:px-8 lg:py-20">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0f172a]">Why Teams Trust TARAsense</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trustItems.map((item) => (
            <article key={item.title} className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#fff7ed] text-[#f97316]">
                <item.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-[#0f172a]">{item.title}</h3>
              <p className="mt-1 text-sm text-[#64748b]">{item.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#f97316] py-16 text-center text-white lg:py-20">
        <div className="mx-auto w-full max-w-4xl px-4 md:px-6">
          <h2 className="text-3xl font-bold tracking-tight">Ready to modernize your food innovation process?</h2>
          <p className="mt-4 text-white/85">
            Start collecting better sensory data and move from feedback to action faster.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="rounded-lg border border-white/30 bg-white px-5 py-2.5 font-semibold text-[#ea580c] hover:bg-[#fff7ed]">
              Create Free Account
            </Link>
            <Link href="/login" className="rounded-lg border border-white/35 px-5 py-2.5 font-semibold text-white hover:bg-white/10">
              Log In
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#e2e8f0] bg-white py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 text-sm text-[#64748b] md:flex-row md:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f97316]">
              <Beaker className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-[#0f172a]">
              TARA<span className="text-[#f97316]">sense</span>
            </span>
          </div>
          <p>{new Date().getFullYear()} TARAsense. Test. Analyze. Refine. Advance.</p>
        </div>
      </footer>
    </div>
  );
}
