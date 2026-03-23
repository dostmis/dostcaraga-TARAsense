import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { PageTransitionIndicator } from "@/components/ui/page-transition-indicator";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "TARAsense",
  description: "Sensory study operations and analytics workspace",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeInitScript = `
(() => {
  try {
    const key = "tara-theme";
    const saved = localStorage.getItem(key);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved === "light" || saved === "dark" ? saved : (prefersDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  } catch (_) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <Suspense fallback={null}>
          <PageTransitionIndicator />
        </Suspense>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
