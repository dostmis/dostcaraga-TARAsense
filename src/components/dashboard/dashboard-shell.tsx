import Link from "next/link";
import type { ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

const statToneStyles = {
  mint: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  sky: "border-blue-200 bg-blue-50 text-blue-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
} as const;

type StatTone = keyof typeof statToneStyles;

export type DashboardShellNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  active?: boolean;
  badge?: string;
};

export type DashboardShellStat = {
  label: string;
  value: string;
  helper?: string;
  icon: LucideIcon;
  tone?: StatTone;
};

type DashboardShellProps = {
  workspaceLabel: string;
  title: string;
  subtitle: string;
  navItems: DashboardShellNavItem[];
  stats?: DashboardShellStat[];
  sidebarFooter?: ReactNode;
  children: ReactNode;
  searchPlaceholder?: string;
  statusLabel?: string;
  searchValue?: string;
};

export function DashboardShell({
  workspaceLabel,
  title,
  subtitle,
  navItems,
  stats = [],
  sidebarFooter,
  children,
  searchPlaceholder = "Search workspace",
  statusLabel = "Workspace overview",
  searchValue = "",
}: DashboardShellProps) {
  const today = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  const activeView = extractViewParam(navItems);

  return (
    <>
      <input id="app-mobile-sidebar-toggle" type="checkbox" className="app-sidebar-toggle" />
      <input id="app-desktop-sidebar-collapse" type="checkbox" className="app-sidebar-toggle" />

      <div className="app-dashboard-shell-container min-h-screen bg-[#f8fafc] text-[#0f172a]">
        <label htmlFor="app-mobile-sidebar-toggle" className="app-sidebar-backdrop" aria-hidden="true" />

        <div className="app-dashboard-shell h-full">
          <aside className="app-shell-sidebar flex h-full min-h-0 flex-col border-r border-[#e2e8f0] bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)] lg:shadow-none">
            <div className="border-b border-[#e2e8f0] px-4 py-4 md:px-5 md:py-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xl font-bold tracking-tight text-[#0f172a]">
                    TARA<span className="text-[#f97316]">sense</span>
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[#64748b]">{workspaceLabel}</p>
                </div>

                <label
                  htmlFor="app-mobile-sidebar-toggle"
                  className="app-mobile-sidebar-close inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc]"
                  title="Close menu"
                  aria-label="Close menu"
                >
                  <X size={16} />
                </label>
              </div>
            </div>

            <nav className="app-shell-nav flex-1 min-h-0 space-y-1.5 overflow-y-auto px-3 py-3 md:px-4">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#94a3b8]">Navigation</p>
              {navItems.map((item) => (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  className={cx(
                    "group flex items-center justify-between rounded-xl border px-2.5 py-2 transition-all",
                    item.active
                      ? "border-[#fed7aa] bg-gradient-to-r from-[#fff7ed] to-white text-[#c2410c] shadow-[0_4px_16px_rgba(249,115,22,0.14)]"
                      : "border-transparent bg-transparent text-[#334155] hover:border-[#e2e8f0] hover:bg-[#f8fafc]"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-[13px] font-semibold leading-5">
                    <span
                      className={cx(
                        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                        item.active
                          ? "border-[#fdba74] bg-[#ffedd5] text-[#c2410c]"
                          : "border-[#e2e8f0] bg-white text-[#64748b] group-hover:border-[#cbd5e1] group-hover:text-[#334155]"
                      )}
                    >
                      <item.icon size={15} />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge && (
                    <span className="rounded-full bg-[#f97316] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </nav>

            {sidebarFooter && <div className="app-shell-sidebar-footer mt-auto border-t border-[#e2e8f0] p-4 md:p-5">{sidebarFooter}</div>}
          </aside>

          <main className="app-shell-main h-full min-h-0 overflow-y-auto">
            <header className="sticky top-0 z-10 border-b border-[#e2e8f0] bg-white/90 px-4 py-3 backdrop-blur-sm md:px-6 lg:px-8">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex w-full items-center gap-2 xl:max-w-md">
                  <label
                    htmlFor="app-mobile-sidebar-toggle"
                    className="app-mobile-menu-trigger inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#64748b] hover:bg-[#f8fafc]"
                    title="Open menu"
                    aria-label="Open menu"
                  >
                    <Menu size={18} />
                  </label>

                  <label
                    htmlFor="app-desktop-sidebar-collapse"
                    className="app-desktop-collapse-trigger hidden h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#64748b] hover:bg-[#f8fafc] lg:inline-flex"
                    title="Show or hide sidebar"
                    aria-label="Show or hide sidebar"
                  >
                    <PanelLeftClose size={16} className="app-collapse-icon-close" />
                    <PanelLeftOpen size={16} className="app-collapse-icon-open" />
                  </label>

                  <form method="get" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5">
                    {activeView && <input type="hidden" name="view" value={activeView} />}
                    <Search size={16} className="text-[#64748b]" />
                    <input
                      name="q"
                      type="search"
                      className="w-full min-w-0 bg-transparent text-sm text-[#1e293b] outline-none placeholder:text-[#64748b]"
                      placeholder={searchPlaceholder}
                      defaultValue={searchValue}
                    />
                  </form>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 text-xs font-semibold text-[#334155]">
                    {statusLabel}
                  </span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#e2e8f0] bg-white text-[#64748b]">
                    <Bell size={14} />
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 text-xs font-medium text-[#64748b]">
                    <CalendarDays size={12} />
                    {today}
                  </span>
                </div>
              </div>
            </header>

            <div className="p-4 md:p-6 lg:p-8">
              <header className="border-b border-[#e2e8f0] pb-5">
                <div className="mt-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#64748b]">{workspaceLabel}</p>
                  <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#0f172a]">{title}</h1>
                  <p className="mt-1 max-w-2xl text-sm text-[#64748b]">{subtitle}</p>
                </div>

                {stats.length > 0 && (
                  <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {stats.map((stat) => (
                      <article key={stat.label} className="rounded-lg border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                        <div className="flex items-center gap-3">
                          <span
                            className={cx(
                              "inline-flex h-10 w-10 items-center justify-center rounded-lg border",
                              statToneStyles[stat.tone ?? "slate"]
                            )}
                          >
                            <stat.icon size={18} />
                          </span>
                          <div>
                            <p className="text-2xl font-semibold text-[#0f172a]">{stat.value}</p>
                            <p className="text-xs uppercase tracking-wide text-[#64748b]">{stat.label}</p>
                          </div>
                        </div>
                        {stat.helper && <p className="mt-3 text-xs text-[#64748b]">{stat.helper}</p>}
                      </article>
                    ))}
                  </section>
                )}
              </header>
              <div className="mt-6 space-y-5">{children}</div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function extractViewParam(navItems: DashboardShellNavItem[]) {
  const activeHref = navItems.find((item) => item.active)?.href;
  if (!activeHref || !activeHref.includes("?")) {
    return undefined;
  }
  const [, query] = activeHref.split("?");
  const params = new URLSearchParams(query);
  const view = params.get("view");
  return view ?? undefined;
}
