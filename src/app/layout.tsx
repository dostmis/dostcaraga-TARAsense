import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { FloatingChatbot } from "@/components/chatbot/floating-chatbot";
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
        <FloatingChatbot />
      </body>
    </html>
  );
}
