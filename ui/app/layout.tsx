import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import StyledRegistry from "@/components/StyledRegistry";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Casproof — verifiable proof of AI agent outputs on Casper",
  description:
    "Producer agents attest AI outputs on the Casper blockchain; consumer DeFi agents verify before releasing a payout. Poison the feed and watch the payout block in real time.",
  icons: { icon: "/favicon.svg" }
};

export const viewport: Viewport = {
  themeColor: "#05060a"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink-950 font-sans text-slate-200 antialiased">
        <StyledRegistry>{children}</StyledRegistry>
      </body>
    </html>
  );
}
