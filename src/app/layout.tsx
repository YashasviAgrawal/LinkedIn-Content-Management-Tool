import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cadence",
  description: "Schedule, review and publish the LinkedIn content pipeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
