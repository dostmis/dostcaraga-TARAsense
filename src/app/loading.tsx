import { Loader2 } from "lucide-react";

export default function GlobalLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f8fafc] px-4">
      <div className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <p className="flex items-center gap-2 text-sm font-medium text-[#334155]">
          <Loader2 size={15} className="animate-spin text-[#f97316]" />
          Loading your next page...
        </p>
      </div>
    </div>
  );
}
