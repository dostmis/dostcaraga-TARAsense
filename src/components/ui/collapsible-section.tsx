import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleSectionProps = {
  title: string;
  children: ReactNode;
  id?: string;
  countLabel?: string;
  defaultOpen?: boolean;
  className?: string;
};

export function CollapsibleSection({
  title,
  children,
  id,
  countLabel,
  defaultOpen = true,
  className,
}: CollapsibleSectionProps) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className={cx("group rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]", className)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[#0f172a]">{title}</h2>
          {countLabel && <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-xs font-semibold text-[#ea580c]">{countLabel}</span>}
        </div>
        <ChevronDown size={18} className="text-[#64748b] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[#e2e8f0] p-5">{children}</div>
    </details>
  );
}

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}
