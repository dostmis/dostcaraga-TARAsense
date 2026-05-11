import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Suspense } from "react";
import { PageTransitionIndicator } from "@/components/ui/page-transition-indicator";
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
    const theme = saved === "light" || saved === "dark" ? saved : "light";
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
        <Script
          src="https://helix.dostcaraga.ph/api/public/widget.js?v=20260507-cors-fix"
          data-public-key="pbk_d323689b14e9189a52874b849acbf07d15fa89e539f54bae"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
