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

const trustDots = ["#FFB56E", "#BBD4FF", "#FF9AEE"];

export function AuthBrandPanel({ headline, body }: AuthBrandPanelProps) {
  return (
    <section className="hero-grid mesh-backdrop relative hidden min-h-screen overflow-hidden bg-gradient-to-br from-secondary via-surface-muted to-brand/5 p-8 lg:flex lg:border-r lg:border-r-divider/50">
      <div className="absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-transparent" />

      <div className="relative z-10 flex h-full w-full flex-col justify-between py-8">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-3 rounded-full border border-divider/70 bg-surface/80 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-soft backdrop-blur transition-all hover:border-brand/40 hover:text-foreground hover:shadow-panel"
        >
          <Globe className="h-4 w-4" />
          TARAsense
        </Link>

        <div className="auth-fade-in space-y-10">
          <div className="space-y-6">
            <div className="auth-gradient-text text-5xl font-semibold leading-[1.02] text-transparent">
              {headline[0]}
              <br />
              {headline[1]}
            </div>

            <p className="max-w-sm text-base leading-8 text-muted-foreground">{body}</p>
          </div>

          <div className="flex gap-3">
            <div className="flex -space-x-2">
              {trustDots.map((color) => (
                <span
                  key={color}
                  className="auth-avatar-dot h-10 w-10 rounded-full border-2 border-surface"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <span className="flex items-center text-sm text-muted-foreground">Trusted by teams worldwide</span>
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
