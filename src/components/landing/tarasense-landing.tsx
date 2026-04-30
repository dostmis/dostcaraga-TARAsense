"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  ChevronDown,
  LineChart,
  Menu,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Star,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

type NavGroup = {
  label: string;
  items: { title: string; description: string }[];
};

type Story = {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  align: "left" | "right";
  points: string[];
  metric: string;
  icon: LucideIcon;
  chartA: number[];
  chartB: number[];
};

type Benefit = {
  title: string;
  body: string;
  icon: LucideIcon;
};

type Logo = {
  label: string;
  src: string;
};

type Testimonial = {
  quote: string;
  name: string;
  role: string;
  company: string;
  result: string;
};

const brand = "TARAsense";

const navGroups: NavGroup[] = [
  {
    label: "Solutions",
    items: [
      { title: "Audience Intelligence", description: "Live demand mapping, concept scoring, and AI-guided segmentation." },
      { title: "Creative Performance", description: "Message testing with second-by-second response analysis." },
      { title: "Brand Health", description: "Continuous sentiment tracking across every growth market." },
    ],
  },
  {
    label: "Platform",
    items: [
      { title: "Insight Copilot", description: "Summaries, recommendations, and share-ready narratives in one workspace." },
      { title: "Connected Workflows", description: "Feedback loops that link ideas, campaigns, testing, and iteration." },
      { title: "Enterprise Governance", description: "Reusable knowledge, permissions, and global operating consistency." },
    ],
  },
  {
    label: "Resources",
    items: [
      { title: "Customer Stories", description: "See how leading teams reduce cycle time and improve launch confidence." },
      { title: "Playbooks", description: "Frameworks for research, experimentation, and cross-functional alignment." },
      { title: "Events", description: "Live sessions on AI strategy, concept validation, and growth planning." },
    ],
  },
];

const visibleNavGroups = navGroups.filter((group) => group.label !== "Solutions" && group.label !== "Platform");

const logos: Logo[] = [
  { label: "Department of Science and Technology - Region XIII", src: "/TARAimage/DOST_Logo.png" },
  { label: "FIC CSU Main Campus", src: "/TARAimage/CSU-MAIN.png" },
  { label: "FIC CSU Cabadbaran Campus", src: "/TARAimage/CSU-CBR.png" },
  { label: "FICSNSU del Carmen Campus", src: "/TARAimage/SNSU.png" },
  { label: "FIC NEMSU Cantilan Campus", src: "/TARAimage/NEMSU.png" },
  { label: "FIC ADSSU Bunawan", src: "/TARAimage/ADSSU.png" },
];

const stories: Story[] = [
  {
    eyebrow: "Signal clarity",
    title: "Video 1",
    body: "Bring concept testing, campaign performance, and brand learning into one elegant operating layer so every team can see the same truth and act faster.",
    cta: "Explore connected workflows",
    align: "right",
    points: ["Unified scorecards", "Audience breakouts", "AI-written decision summaries"],
    metric: "87 launch confidence",
    icon: BrainCircuit,
    chartA: [42, 58, 64, 52, 76, 88, 84],
    chartB: [24, 28, 36, 33, 48, 56, 61],
  },
  {
    eyebrow: "Creative intelligence",
    title: "Image 1",
    body: "Blend qualitative reactions, emotion signals, and performance forecasting into premium creative scorecards your brand team can use immediately.",
    cta: "Review creative analytics",
    align: "left",
    points: ["Moment-by-moment feedback", "Conversion drivers", "Market-by-market comparisons"],
    metric: "+29% lift forecast",
    icon: LineChart,
    chartA: [28, 34, 52, 63, 58, 76, 82],
    chartB: [16, 24, 31, 45, 42, 51, 60],
  },
  {
    eyebrow: "Enterprise memory",
    title: "Turn every project into reusable intelligence for the next launch.",
    body: "Store winning messages, rejected concepts, and emerging demand signals in a system that keeps strategy teams aligned across markets, regions, and product lines.",
    cta: "See knowledge flows",
    align: "right",
    points: ["Insight archives", "Governed templates", "Cross-market learnings"],
    metric: "12 markets aligned",
    icon: ShieldCheck,
    chartA: [18, 30, 44, 58, 68, 73, 85],
    chartB: [12, 20, 26, 32, 40, 51, 59],
  },
];

const loopSteps = [
  { title: "Test", body: "Validate concepts and messages with live audiences." },
  { title: "Learn", body: "Surface why response shifts and which signals matter." },
  { title: "Align", body: "Give teams one shared recommendation set." },
  { title: "Optimize", body: "Feed every outcome back into the next iteration." },
];

const benefits: Benefit[] = [
  { title: "Executive-ready narratives", body: "Summaries are structured for decisions, not dashboards full of noise.", icon: Sparkles },
  { title: "Continuous validation", body: "Keep the consumer in the loop from idea framing to post-launch refinement.", icon: Workflow },
  { title: "High-signal benchmarking", body: "Compare markets, campaigns, and concepts with consistent enterprise scoring.", icon: LineChart },
  { title: "AI that guides action", body: "Get sharp next-step recommendations built directly into every workspace.", icon: BrainCircuit },
  { title: "Governance by design", body: "Permissions, templates, and evidence trails keep global teams aligned and secure.", icon: ShieldCheck },
  { title: "Human-centered collaboration", body: "Share clips, comments, and customer truths without losing the story behind the data.", icon: MessageSquareText },
];

const testimonials: Testimonial[] = [
  {
    quote: "TARAsense gave our insights team the credibility of a strategy function. We now walk into launch reviews with proof, not just perspective.",
    name: "Stephan Gans",
    role: "SVP Consumer Insights & Analytics",
    company: "PepsiCo",
    result: "+30% creative effectiveness",
  },
  {
    quote: "We replaced fragmented reporting with one connected view of demand, brand signal, and campaign readiness. Decision speed changed immediately.",
    name: "Amanda Addison",
    role: "Senior Manager, Menu Insights",
    company: "McDonald's",
    result: "4 weeks saved per campaign cycle",
  },
  {
    quote: "The platform made insight feel operational. Regional teams could act locally while leadership still saw one coherent system.",
    name: "Rachel Morgan",
    role: "Global Brand Director",
    company: "Vodafone",
    result: "12 markets working from one source of truth",
  },
];

const footerGroups = [
  { title: "Solutions", links: ["Audience intelligence", "Creative analytics", "Brand tracking", "Concept validation"] },
  { title: "Platform", links: ["Insight Copilot", "Connected workflows", "Governance", "API & integrations"] },
  { title: "Resources", links: ["Customer stories", "Playbooks", "Events", "Blog"] },
  { title: "Company", links: ["About", "Careers", "Contact", "Trust center"] },
];

const footerLinkHref: Record<string, string> = {
  "Audience intelligence": "#solutions",
  "Creative analytics": "#solutions",
  "Brand tracking": "#solutions",
  "Concept validation": "#solutions",
  "Insight Copilot": "#solutions",
  "Connected workflows": "#solutions",
  Governance: "#solutions",
  "API & integrations": "#final-cta",
  "Customer stories": "#proof",
  Playbooks: "#solutions",
  Events: "#final-cta",
  Blog: "#proof",
  About: "#hero",
  Careers: "#footer",
  Contact: "#final-cta",
  "Trust center": "#proof",
};

function DostBrandLogo() {
  return (
    <span className="inline-flex h-12 w-[177px] items-center">
      <Image
        src="/TARAimage/DOST_Logo_with.png"
        alt=""
        width={214}
        height={58}
        className="tara-logo-light h-12 w-auto object-contain"
        priority
      />
      <Image
        src="/TARAimage/DOST_Logo_Inverse.png"
        alt=""
        width={214}
        height={58}
        className="tara-logo-dark h-12 w-auto object-contain"
        priority
      />
    </span>
  );
}

function TarasenseWordmark() {
  return (
    <span className="text-xl font-black tracking-tight" aria-label="TARAsense">
      <span className="text-[#1746ff]">TARA</span>
      <span className="text-[#f97316]">sense</span>
    </span>
  );
}

export function TarasenseLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [compactHeader, setCompactHeader] = useState(false);
  const [activeTestimonial, setActiveTestimonial] = useState(0);

  useEffect(() => {
    const onScroll = () => setCompactHeader(window.scrollY > 18);

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveTestimonial((current) => (current + 1) % testimonials.length);
    }, 5200);

    return () => window.clearInterval(interval);
  }, []);

  const supportingTestimonials = useMemo(
    () => testimonials.filter((_, index) => index !== activeTestimonial).slice(0, 2),
    [activeTestimonial],
  );

  return (
    <div className="relative overflow-x-clip bg-background text-foreground">
      <div className="mesh-backdrop pointer-events-none absolute inset-0 -z-10 opacity-90" />
      <div className="bg-mesh pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem]" />

      <header className="tara-fade-down sticky top-0 z-40">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div
            className={`rounded-full transition-all duration-500 ${
              compactHeader
                ? "border border-divider/70 bg-surface/80 shadow-panel backdrop-blur-xl"
                : "border-0 bg-transparent shadow-none"
            }`}
          >
            <div className={`relative flex items-center justify-between gap-4 px-4 transition-all duration-500 md:px-6 ${compactHeader ? "py-3" : "py-4"}`}>
              <div className="flex min-w-0 items-center">
                <Link href="#hero" className="focus-ring flex items-center rounded-full px-1 py-1" aria-label="TARAsense home">
                  <DostBrandLogo />
                </Link>
              </div>

              <div className="absolute left-1/2 hidden -translate-x-1/2 items-center lg:flex">
                <nav className="absolute right-full mr-6 flex items-center gap-2 whitespace-nowrap" aria-label="Primary navigation">
                  {visibleNavGroups.map((group) => (
                    <div
                      key={group.label}
                      className="relative"
                      onMouseEnter={() => setActiveMenu(group.label)}
                      onMouseLeave={() => setActiveMenu(null)}
                    >
                      <button
                        type="button"
                        className="focus-ring inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-all duration-300 hover:bg-surface hover:text-foreground"
                        aria-expanded={activeMenu === group.label}
                        onFocus={() => setActiveMenu(group.label)}
                      >
                        {group.label}
                        <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${activeMenu === group.label ? "rotate-180 text-brand" : ""}`} />
                      </button>

                      {activeMenu === group.label && (
                        <div className="absolute left-1/2 top-full z-30 mt-4 w-[42rem] -translate-x-1/2 max-w-[calc(100vw-2rem)]">
                          <div className="glass-panel tara-menu-enter p-4">
                            <div className="grid min-w-0 gap-3 md:grid-cols-3">
                              {group.items.map((item) => (
                                <a
                                  key={item.title}
                                  href="#solutions"
                                  className="min-w-0 rounded-[1.25rem] border border-transparent bg-surface p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-brand/20 hover:shadow-soft"
                                >
                                  <p className="break-words font-semibold text-foreground">{item.title}</p>
                                  <p className="mt-2 whitespace-normal break-words text-sm leading-6 text-muted-foreground">{item.description}</p>
                                </a>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <a href="#proof" className="link-accent rounded-full px-4 py-2 text-sm">Customers</a>
                  <a href="#footer" className="link-accent rounded-full px-4 py-2 text-sm">Company</a>
                </nav>

                <Link href="https://tarasense.dostcaraga.ph/" className="focus-ring rounded-full px-2 py-1" aria-label="TARAsense home">
                  <TarasenseWordmark />
                </Link>
              </div>

              <div className="hidden items-center gap-3 lg:flex">
                <Link href="/login" className="btn-nav">Sign in</Link>
              </div>

              <button
                type="button"
                className="btn-icon lg:!hidden"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Toggle navigation menu"
                aria-expanded={menuOpen}
              >
                <Menu />
              </button>
            </div>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="tara-menu-enter fixed inset-0 z-[100] overflow-y-auto bg-white text-foreground lg:!hidden">
          <div className="flex min-h-dvh flex-col px-6 py-5 sm:px-8">
            <div className="flex items-center justify-between">
              <Link href="#hero" className="focus-ring flex items-center rounded-full px-1 py-1" aria-label="TARAsense home" onClick={() => setMenuOpen(false)}>
                <DostBrandLogo />
              </Link>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setMenuOpen(false)}
                aria-label="Close navigation menu"
              >
                <X />
              </button>
            </div>

            <nav className="mt-10 flex flex-1 flex-col gap-8" aria-label="Mobile navigation">
              {visibleNavGroups.map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">{group.label}</p>
                  <div className="mt-3 grid gap-2">
                    {group.items.map((item) => (
                      <a
                        key={item.title}
                        href="#solutions"
                        className="rounded-2xl border border-divider/70 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-soft transition-colors hover:border-brand/25"
                        onClick={() => setMenuOpen(false)}
                      >
                        {item.title}
                      </a>
                    ))}
                  </div>
                </div>
              ))}

              <div className="grid gap-3 pt-2">
                <a href="#proof" className="rounded-2xl border border-divider/70 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-soft" onClick={() => setMenuOpen(false)}>
                  Customers
                </a>
                <a href="#footer" className="rounded-2xl border border-divider/70 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-soft" onClick={() => setMenuOpen(false)}>
                  Company
                </a>
              </div>

              <div className="mt-auto grid gap-3 border-t border-divider/70 pt-6">
                <Link href="/login" className="btn-secondary justify-center" onClick={() => setMenuOpen(false)}>Sign in</Link>
                <Link href="/register" className="btn-hero justify-center" onClick={() => setMenuOpen(false)}>Get Started</Link>
              </div>
            </nav>
          </div>
        </div>
      )}

      <main>
        <section id="hero" className="section-shell overflow-hidden md:pt-10">
          <div className="mx-auto grid w-full max-w-7xl items-start gap-16 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
            <div className="tara-hero-copy relative z-10 max-w-2xl">
              <div className="tara-reveal section-label">
                <Sparkles className="h-4 w-4" />
                Enterprise market intelligence
              </div>

              <h1 className="text-display tara-reveal max-w-[12ch] text-5xl text-foreground sm:text-6xl lg:text-7xl">
                Test. Analyze. Refine. Advance.
              </h1>

              <p className="tara-reveal mt-8 max-w-xl text-body">
                Sensory and consumer driven food innovation platform that connects MSMEs, Consumer and Government support networks in one smart digital platform.
              </p>

              <div className="tara-reveal mt-10 flex flex-col gap-4 sm:flex-row">
                <Link href="/register" className="btn-hero btn-xl">
                  Get Started
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            <div className="tara-scale-in relative flex items-center justify-center">
              <div className="glass-panel hero-grid panel-sheen relative w-full max-w-xl overflow-hidden p-6 md:p-4">
                <div className="relative z-10 aspect-[2048/1365] w-full overflow-hidden rounded-[1.5rem] shadow-soft">
                  <Image src="/TARAimage/Selected/DSC_0209.JPG" alt="TARAsense launch interface" fill sizes="(min-width: 1024px) 42vw, 92vw" className="object-cover" priority />
                </div>
              </div>
            </div>
          </div>

          <div className="tara-reveal mx-auto mt-10 w-full max-w-7xl px-4 sm:px-6 md:mt-14 lg:px-8">
            <div className="rounded-[2rem] border border-divider/70 bg-surface/80 px-6 py-5 shadow-soft backdrop-blur-xl md:px-8">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Food Innovation Centers</p>
              <div className="logo-marquee mt-4 overflow-hidden">
                <div className="marquee-track" aria-label="Food Innovation Centers">
                  {[0, 1].map((groupIndex) => (
                    <div key={groupIndex} className="marquee-group" aria-hidden={groupIndex === 1}>
                      {logos.map((logo) => (
                        <div key={`${logo.label}-${groupIndex}`} className="partner-logo">
                          <Image src={logo.src} alt={logo.label} width={64} height={64} className="partner-logo__image" />
                          <span className="partner-logo__label">{logo.label}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="solutions" className="section-shell -mt-8">
          <div className="mx-auto w-full max-w-7xl space-y-24 px-4 sm:px-6 lg:px-8">
            {stories.map((story, index) => (
              <div key={story.title} className={`grid gap-12 lg:grid-cols-2 lg:gap-16 ${index <= 1 ? "items-start" : "items-center"}`}>
                <div className={`tara-reveal ${story.align === "left" ? "lg:order-2" : ""}`}>
                  <span className="section-label">{story.eyebrow}</span>
                  <h2 className="text-display max-w-2xl text-4xl text-foreground md:text-[2.75rem] lg:text-5xl">{story.title}</h2>
                  <p className="mt-6 max-w-xl text-body">{story.body}</p>
                  <ul className="mt-8 space-y-3">
                    {story.points.map((point) => (
                      <li key={point} className="flex items-center gap-3 text-base text-foreground">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-brand">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <Link href="/register" className="btn-secondary mt-8">
                    {story.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                <div className={`${story.align === "left" ? "lg:order-1" : ""}`}>
                  <SolutionVisual story={story} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-shell">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div className="tara-reveal">
              <span className="section-label">Connected system</span>
              <h2 className="text-display max-w-[12ch] text-4xl text-foreground md:text-5xl">A continuous loop that turns insight into momentum.</h2>
              <p className="mt-6 max-w-xl text-body">
                Instead of isolated studies, TARAsense creates a feedback engine. Every experiment sharpens the next decision, every campaign teaches the next launch, and every market signal stays connected.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {loopSteps.map((step) => (
                  <div key={step.title} className="rounded-[1.5rem] border border-divider/70 bg-surface/90 p-5 shadow-soft">
                    <p className="text-lg font-semibold text-foreground">{step.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="tara-reveal relative flex items-center justify-center">
              <div className="relative h-[30rem] w-full max-w-[36rem] rounded-[2.5rem] border border-divider/70 bg-surface/85 shadow-panel backdrop-blur-xl">
                <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full" aria-hidden="true">
                  <path
                    d="M300,90 C415,90 510,185 510,300 C510,415 415,510 300,510 C185,510 90,415 90,300 C90,185 185,90 300,90 Z"
                    fill="none"
                    stroke="var(--divider)"
                    strokeWidth="2"
                    strokeDasharray="8 12"
                  />
                  <path
                    className="loop-path"
                    d="M300,90 C415,90 510,185 510,300 C510,415 415,510 300,510 C185,510 90,415 90,300 C90,185 185,90 300,90 Z"
                    fill="none"
                    stroke="url(#loop-gradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="loop-gradient" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" />
                      <stop offset="100%" stopColor="var(--support)" />
                    </linearGradient>
                  </defs>
                </svg>

                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="loop-core flex h-44 w-44 flex-col items-center justify-center rounded-full bg-brand text-brand-foreground shadow-glow">
                    <span className="text-sm uppercase tracking-[0.2em] text-brand-foreground/80">Core loop</span>
                    <span className="mt-3 max-w-[8ch] text-center text-3xl font-semibold leading-tight">Better decisions, continuously</span>
                  </div>
                </div>

                {[
                  { className: "left-1/2 top-10 -translate-x-1/2", title: "Test" },
                  { className: "right-10 top-1/2 -translate-y-1/2", title: "Learn" },
                  { className: "bottom-10 left-1/2 -translate-x-1/2", title: "Optimize" },
                  { className: "left-10 top-1/2 -translate-y-1/2", title: "Align" },
                ].map((node) => (
                  <div
                    key={node.title}
                    className={`absolute ${node.className} flex h-28 w-28 items-center justify-center rounded-full border border-divider/70 bg-surface text-center text-sm font-semibold text-foreground shadow-soft`}
                  >
                    {node.title}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section-shell">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="tara-reveal max-w-2xl">
              <span className="section-label">Why teams choose TARAsense</span>
              <h2 className="text-display text-4xl text-foreground md:text-5xl">A platform designed for enterprise confidence, not dashboard fatigue.</h2>
              <p className="mt-6 text-body">Every interaction is built to feel strategic, quick, and premium from first signal to final recommendation.</p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {benefits.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div
                    key={benefit.title}
                    className="group tara-reveal rounded-[1.75rem] border border-divider/70 bg-surface p-6 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:border-brand/25 hover:shadow-panel"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-6 text-2xl font-semibold text-foreground">{benefit.title}</h3>
                    <p className="mt-4 text-base leading-7 text-muted-foreground">{benefit.body}</p>
                    <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand">
                      Learn more
                      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="proof" className="section-shell">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 sm:px-6 xl:grid-cols-[1.15fr_0.85fr] lg:px-8">
            <div className="tara-reveal rounded-[2rem] border border-divider/70 bg-surface p-8 shadow-panel md:p-10">
              <span className="section-label">Customer proof</span>
              <div className="relative min-h-[22rem]">
                <div className="flex h-full flex-col justify-between">
                  <div>
                    <p className="max-w-3xl text-3xl font-semibold leading-tight text-foreground md:text-4xl">&quot;{testimonials[activeTestimonial].quote}&quot;</p>
                    <div className="mt-8 flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-lg font-semibold text-brand-foreground shadow-glow">
                        {testimonials[activeTestimonial].name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-foreground">{testimonials[activeTestimonial].name}</p>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {testimonials[activeTestimonial].role} · {testimonials[activeTestimonial].company}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 flex flex-wrap items-center gap-4">
                    <div className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground">
                      {testimonials[activeTestimonial].result}
                    </div>
                    <div className="stat-pill">
                      <Star className="h-4 w-4 text-support" />
                      Trusted by enterprise strategy teams
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-6">
              {supportingTestimonials.map((testimonial) => (
                <div key={testimonial.quote} className="tara-reveal rounded-[1.75rem] border border-divider/70 bg-surface p-6 shadow-soft">
                  <p className="text-xl font-semibold leading-tight text-foreground">&quot;{testimonial.quote}&quot;</p>
                  <div className="mt-6 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-foreground">{testimonial.name}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{testimonial.company}</p>
                    </div>
                    <div className="rounded-full bg-surface-muted px-4 py-2 text-sm font-medium text-foreground">{testimonial.result}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="final-cta" className="section-shell pb-24">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="tara-reveal relative overflow-hidden rounded-[2.5rem] border border-divider/70 bg-cta px-8 py-12 shadow-panel md:px-14 md:py-16">
              <div className="relative z-10 max-w-3xl">
                <span className="section-label">Ready when your team is</span>
                <h2 className="text-display text-4xl text-foreground md:text-6xl">Build a sharper growth engine around what customers actually signal.</h2>
                <p className="mt-6 max-w-2xl text-body">
                  Replace fragmented reporting with a premium system for testing, learning, and action. Your next board-ready insight can start with one conversation.
                </p>
                <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                  <Link href="/register" className="btn-hero btn-xl">
                    Book your strategy demo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a href="#solutions" className="btn-secondary btn-xl">See the platform tour</a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer id="footer" className="border-t border-divider/70 bg-surface/80 pb-12 pt-16 backdrop-blur-xl">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <div className="tara-reveal">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-glow">A</span>
              <span className="text-xl font-semibold text-foreground">{brand}</span>
            </div>
            <p className="mt-5 max-w-md text-base leading-8 text-muted-foreground">
              Premium market intelligence for enterprise teams that want faster alignment, clearer decisions, and stronger launches.
            </p>
            <div className="mt-8 flex items-center gap-3 text-sm font-medium text-muted-foreground">
              <span className="rounded-full border border-divider/70 px-4 py-2">LinkedIn</span>
              <span className="rounded-full border border-divider/70 px-4 py-2">X</span>
              <span className="rounded-full border border-divider/70 px-4 py-2">YouTube</span>
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {footerGroups.map((group) => (
              <div key={group.title} className="tara-reveal">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{group.title}</h3>
                <ul className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <li key={link}>
                      <a href={footerLinkHref[link] ?? "#hero"} className="link-accent text-sm text-foreground">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-14 flex w-full max-w-7xl flex-col gap-4 border-t border-divider/70 px-4 pt-6 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="flex flex-wrap gap-5">
            <a href="#footer" className="link-accent text-sm">Privacy</a>
            <a href="#footer" className="link-accent text-sm">Terms</a>
            <a href="#footer" className="link-accent text-sm">Security</a>
          </div>
          <p>© 2026 {brand}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function SolutionVisual({ story }: { story: Story }) {
  const Icon = story.icon;
  const chartId = `line-a-${story.eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  if (story.eyebrow === "Signal clarity") {
    return (
      <div className="tara-reveal relative flex items-center justify-center">
        <div className="glass-panel hero-grid panel-sheen relative w-full max-w-xl overflow-hidden p-6 md:p-4">
          <video
            src="/TARAvideo/IMG_1408.mp4"
            className="relative z-10 aspect-[2048/1365] w-full rounded-[1.5rem] object-cover shadow-soft"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            aria-label="Signal clarity demonstration video"
          />
        </div>
      </div>
    );
  }

  if (story.eyebrow === "Creative intelligence") {
    return (
      <div className="tara-reveal relative flex items-center justify-center">
        <div className="glass-panel hero-grid panel-sheen relative w-full max-w-xl overflow-hidden p-6 md:p-4">
          <div className="relative z-10 aspect-[2048/1365] w-full overflow-hidden rounded-[1.5rem] shadow-soft">
            <Image src="/TARAimage/Selected/DSC_0098.JPG" alt="Creative intelligence field activity" fill sizes="(min-width: 1024px) 42vw, 92vw" className="object-cover" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tara-reveal relative">
      <div className="glass-panel panel-sheen hero-grid relative overflow-hidden p-6 md:p-8">
        <div className="relative z-10 flex items-center justify-between gap-4 pb-8">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{story.eyebrow}</p>
            <h3 className="mt-2 text-xl font-semibold text-foreground">Live workspace</h3>
          </div>
          <div className="stat-pill">
            <Icon className="h-4 w-4 text-brand" />
            <span>{story.metric}</span>
          </div>
        </div>

        <div className="relative z-10 grid gap-5 md:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[1.5rem] border border-divider/70 bg-surface p-5 shadow-soft">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-support">Forecast</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{story.metric}</p>
              </div>
              <div className="rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand">AI guided</div>
            </div>

            <svg viewBox="0 0 340 180" className="h-44 w-full overflow-visible" aria-hidden="true">
              <defs>
                <linearGradient id={chartId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--brand)" />
                  <stop offset="100%" stopColor="var(--support)" />
                </linearGradient>
              </defs>
              {Array.from({ length: 5 }).map((_, index) => (
                <line
                  key={index}
                  x1="0"
                  x2="340"
                  y1={20 + index * 35}
                  y2={20 + index * 35}
                  stroke="var(--divider)"
                  strokeWidth="1"
                />
              ))}
              <polyline
                fill="none"
                stroke={`url(#${chartId})`}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={story.chartA.map((value, index) => `${index * 56 + 2},${170 - value * 1.7}`).join(" ")}
              />
              <polyline
                fill="none"
                stroke="rgba(23, 70, 255, 0.35)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={story.chartB.map((value, index) => `${index * 56 + 2},${172 - value * 2.2}`).join(" ")}
              />
              {story.chartA.map((value, index) => (
                <circle key={index} cx={index * 56 + 2} cy={170 - value * 1.7} r="5.5" fill="var(--surface)" stroke="var(--brand)" strokeWidth="3" />
              ))}
            </svg>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.5rem] border border-divider/70 bg-surface p-5 shadow-soft">
              <p className="text-sm font-medium text-muted-foreground">Top actions</p>
              <div className="mt-4 space-y-3">
                {story.points.map((point, index) => (
                  <div key={point} className="flex items-center justify-between rounded-full bg-surface-muted px-4 py-3 text-sm text-foreground">
                    <span>{point}</span>
                    <span className="text-muted-foreground">0{index + 1}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[1.5rem] border border-divider/70 bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Signal mix</span>
                <span className="text-sm font-semibold text-foreground">Live</span>
              </div>
              <div className="mt-4 space-y-3">
                {[78, 62, 49].map((width, index) => (
                  <div key={width} className="space-y-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <span>{["Intent", "Clarity", "Recall"][index]}</span>
                      <span>{width}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${width}%`, opacity: index === 1 ? 0.75 : index === 2 ? 0.55 : 1 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="floating-card absolute -left-4 top-8 hidden rounded-[1.5rem] border border-divider/70 bg-surface px-4 py-3 shadow-panel md:block">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Audience pulse</p>
        <p className="mt-1 text-lg font-semibold text-foreground">Trend improving</p>
      </div>

      <div className="floating-card floating-card-delayed absolute -bottom-5 right-6 hidden rounded-[1.5rem] border border-divider/70 bg-surface px-4 py-3 shadow-panel md:block">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next best move</p>
        <p className="mt-1 text-lg font-semibold text-foreground">Shift budget to high-intent segments</p>
      </div>
    </div>
  );
}
