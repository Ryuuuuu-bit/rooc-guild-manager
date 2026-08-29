import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

// Loma (Thai Linux Working Group / NECTEC, GPL-2+ with font-embedding
// exception — see ./fonts/LICENSE-Loma.txt) self-hosted so every visitor
// sees the same Thai type regardless of what's installed on their device.
const loma = localFont({
  src: [
    { path: "./fonts/Loma-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Loma-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-loma",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Divine Guild Manager",
  description: "Member management for the Divine guild (ROOC), synced with Discord.",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${loma.variable}`}>
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans">
        {children}
      </body>
    </html>
  );
}
