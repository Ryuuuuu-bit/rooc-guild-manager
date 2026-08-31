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
      {/* overflow-x-hidden is a safety net for the /pvp-stats table, which
       * deliberately breaks out to `100vw` (see PvpStatsTable) to get real
       * screen width instead of being stuck inside the app's centered
       * max-w-6xl content column. `100vw` is measured including the
       * vertical scrollbar's own width, which is ~1px wider than the
       * actual visible viewport on most desktop browsers — this clips that
       * harmless sliver instead of letting it show up as a page-wide
       * horizontal scrollbar. */}
      <body className="min-h-full flex flex-col overflow-x-hidden bg-zinc-950 text-zinc-100 font-sans">
        {children}
      </body>
    </html>
  );
}
