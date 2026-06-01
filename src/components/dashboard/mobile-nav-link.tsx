"use client";

import Link from "next/link";

type Props = {
  href: string;
  className: string;
  children: React.ReactNode;
};

export function MobileNavLink({ href, className, children }: Props) {
  function closeMobileSidebar() {
    const toggle = document.getElementById("app-mobile-sidebar-toggle") as HTMLInputElement | null;
    if (toggle) toggle.checked = false;
  }

  return (
    <Link href={href} className={className} onClick={closeMobileSidebar}>
      {children}
    </Link>
  );
}
