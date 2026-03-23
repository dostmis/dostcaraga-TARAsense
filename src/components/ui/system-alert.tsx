import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

type AlertVariant = "error" | "success" | "info" | "warning";

type SystemAlertProps = {
  title: string;
  message: string;
  variant?: AlertVariant;
};

const ALERT_STYLES: Record<
  AlertVariant,
  {
    wrapper: string;
    icon: string;
  }
> = {
  error: {
    wrapper: "border-red-200 bg-red-50 text-red-800",
    icon: "text-red-600",
  },
  success: {
    wrapper: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: "text-emerald-600",
  },
  info: {
    wrapper: "border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]",
    icon: "text-[#f97316]",
  },
  warning: {
    wrapper: "border-amber-200 bg-amber-50 text-amber-800",
    icon: "text-amber-600",
  },
};

export function SystemAlert({ title, message, variant = "info" }: SystemAlertProps) {
  const style = ALERT_STYLES[variant];

  return (
    <div className={`system-alert-pop rounded-xl border px-4 py-3 text-sm shadow-sm ${style.wrapper}`}>
      <div className="flex items-start gap-2.5">
        {renderIcon(variant, style.icon)}
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 opacity-95">{message}</p>
        </div>
      </div>
    </div>
  );
}

function renderIcon(variant: AlertVariant, className: string) {
  if (variant === "error") return <AlertCircle size={17} className={`mt-0.5 ${className}`} />;
  if (variant === "success") return <CheckCircle2 size={17} className={`mt-0.5 ${className}`} />;
  if (variant === "warning") return <TriangleAlert size={17} className={`mt-0.5 ${className}`} />;
  return <Info size={17} className={`mt-0.5 ${className}`} />;
}
