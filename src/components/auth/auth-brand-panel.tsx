import Image from "next/image";
import Link from "next/link";
import { Globe } from "lucide-react";

type AuthBrandPanelProps = {
  headline: [string, string];
  body: string;
};

const navItems = [
  { label: "Product", href: "/#hero" },
  { label: "Capabilities", href: "/#solutions" },
  { label: "Pricing", href: "/register" },
  { label: "Resources", href: "/#proof" },
  { label: "Enterprise", href: "/#final-cta" },
];

export function AuthBrandPanel({ headline, body }: AuthBrandPanelProps) {
  return (
    <section className="hero-grid mesh-backdrop relative hidden min-h-screen overflow-hidden bg-gradient-to-br from-secondary via-surface-muted to-brand/5 p-8 lg:flex lg:border-r lg:border-r-divider/50">
      <div className="absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-transparent" />

      <div className="relative z-10 flex h-full w-full flex-col justify-between py-8">
        <Link
          href="/"
          style={{ backgroundImage: "var(--gradient-brand)" }}
          className="inline-flex w-fit items-center gap-3 rounded-full border border-transparent px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:shadow-panel"
        >
          <Globe className="h-4 w-4" />
          TARAsense
        </Link>

        <div className="auth-fade-in -translate-y-8 space-y-10">
          <div className="space-y-6 text-center">
            <div className="flex items-center justify-center gap-4">
              <Image
                src="/TARAsense_logo.png"
                alt="TARAsense"
                width={96}
                height={96}
                className="h-20 w-20 shrink-0 object-contain"
                priority
              />
              <span
                className="inline-flex items-baseline whitespace-nowrap text-7xl font-black leading-none tracking-normal"
                aria-label="TARAsense"
              >
                <span className="text-[#10254f]">TARA</span>
                <span
                  style={{
                    backgroundImage: "var(--gradient-brand)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    color: "transparent",
                  }}
                >
                  sense
                </span>
              </span>
            </div>

            <div className="auth-gradient-text text-6xl font-semibold leading-[1.02] text-transparent">
              {headline[0]}
              <br />
              {headline[1]}
            </div>

            <p className="mx-auto max-w-sm text-base leading-8 text-muted-foreground">{body}</p>
          </div>
        </div>

        <nav className="auth-fade-in flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Authentication footer navigation">
          {navItems.map((item) => (
            <Link key={item.label} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
