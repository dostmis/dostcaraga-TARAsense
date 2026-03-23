"use client";

import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

type ToastVariant = "error" | "success" | "info" | "warning";

type TimedToastProps = {
  title: string;
  message?: string | null;
  variant?: ToastVariant;
  durationMs?: number;
};

const TOAST_STYLES: Record<
  ToastVariant,
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

export function TimedToast({ title, message, variant = "info", durationMs = 3000 }: TimedToastProps) {
  const [visible, setVisible] = useState(Boolean(message));
  const style = TOAST_STYLES[variant];

  useEffect(() => {
    if (!message) {
      return;
    }

    const showTimer = window.setTimeout(() => {
      setVisible(true);
    }, 0);
    const hideTimer = window.setTimeout(() => {
      setVisible(false);
    }, durationMs);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [message, durationMs]);

  if (!message || !visible) {
    return null;
  }

  return (
    <div className={`system-alert-pop rounded-2xl border p-4 text-sm ${style.wrapper}`}>
      <div className="flex items-start gap-2.5">
        {renderIcon(variant, style.icon)}
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5">{message}</p>
        </div>
      </div>
    </div>
  );
}

function renderIcon(variant: ToastVariant, className: string) {
  if (variant === "error") return <AlertCircle size={17} className={`mt-0.5 ${className}`} />;
  if (variant === "success") return <CheckCircle2 size={17} className={`mt-0.5 ${className}`} />;
  if (variant === "warning") return <TriangleAlert size={17} className={`mt-0.5 ${className}`} />;
  return <Info size={17} className={`mt-0.5 ${className}`} />;
}
