import type { Metadata, Viewport } from "next";
import StyledRegistry from "@/components/StyledRegistry";
import "./globals.css";

export const metadata: Metadata = {
  title: "Casproof — the unskippable on-chain action firewall for AI agents",
  description:
    "Casproof runs the verify decision and the value-bearing action in one atomic Casper VM call, so an off-chain agent cannot skip the check. Poison the feed and watch the on-chain release revert in real time.",
  icons: { icon: "/favicon.svg" }
};

export const viewport: Viewport = {
  themeColor: "#05060a"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className="min-h-screen font-sans antialiased"
        style={{ background: "#0a0a0a", color: "#f0f0f0" }}
      >
        <StyledRegistry>{children}</StyledRegistry>
      </body>
    </html>
  );
}
