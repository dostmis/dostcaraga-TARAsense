"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

type AppBackButtonProps = {
  fallbackHref: string;
  label?: string;
  className?: string;
};

export function AppBackButton({ fallbackHref, label = "Back", className }: AppBackButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={[
        "app-button-secondary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
    >
      <ArrowLeft size={16} />
      {label}
    </button>
  );
}
