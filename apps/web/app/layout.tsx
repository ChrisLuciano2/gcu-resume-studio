import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "resume-studio",
  description: "Bring-your-own-infra resume tailoring for GCU students.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
