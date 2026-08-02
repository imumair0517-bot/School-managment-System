import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "School SaaS OS",
  description: "Multi-tenant school management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
