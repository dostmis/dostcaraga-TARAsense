"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const TRANSITION_MS = 480;

export function PageTransitionIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const firstRender = useRef(true);
  const routeKey = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const showTimer = window.setTimeout(() => {
      setVisible(true);
    }, 0);
    const hideTimer = window.setTimeout(() => {
      setVisible(false);
    }, TRANSITION_MS);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [routeKey]);

  return (
    <div className={`page-transition-shell ${visible ? "page-transition-shell--active" : ""}`} aria-hidden="true">
      <div className="page-transition-bar" />
      <div className="page-transition-chip">
        <Loader2 size={12} className="animate-spin" />
        <span>Loading</span>
      </div>
    </div>
  );
}
