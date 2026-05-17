import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter is the closest free match for the Figma's Aeonik wordmark feel.
const inter = Inter({
  variable: "--font-sans-app",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const jbMono = JetBrains_Mono({
  variable: "--font-mono-app",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Node42 — Pharma Map",
  description: "Oncology pharma & biotech sales intelligence map",
};

const themeBootScript = `try { var t = localStorage.getItem('theme') || 'dark'; document.documentElement.dataset.theme = t; } catch (e) {}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${inter.variable} ${jbMono.variable} h-full antialiased dark`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg-page)] text-[var(--ink)]">
        {children}
      </body>
    </html>
  );
}
