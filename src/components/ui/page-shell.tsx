import type { ReactNode } from "react";

type PageShellProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
};

export function PageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  maxWidthClassName = "max-w-6xl",
}: PageShellProps) {
  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-6 md:px-6 md:py-8">
      <main className={`mx-auto w-full ${maxWidthClassName} space-y-5`}>
        {(eyebrow || title || description || actions) && (
          <section className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] md:p-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                {eyebrow && <p className="text-xs uppercase tracking-[0.2em] text-[#64748b]">{eyebrow}</p>}
                {title && <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#0f172a]">{title}</h1>}
                {description && <p className="mt-2 max-w-3xl text-sm text-[#64748b]">{description}</p>}
              </div>
              {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
            </div>
          </section>
        )}
        {children}
      </main>
    </div>
  );
}

type SurfaceCardProps = {
  children: ReactNode;
  className?: string;
};

export function SurfaceCard({ children, className }: SurfaceCardProps) {
  return (
    <section className={cx("rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]", className)}>
      {children}
    </section>
  );
}

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}
