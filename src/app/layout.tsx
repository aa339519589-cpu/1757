import type { Metadata } from "next";
import { Navigation } from "@/components/navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay - Universal AI Capability Platform",
  description: "Connect AI APIs and use them through one capability-first workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Navigation />
        <main>{children}</main>
      </body>
    </html>
  );
}
