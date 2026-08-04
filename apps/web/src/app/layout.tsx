import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwingSage",
  description: "AI golf swing analysis",
};

// Videos are filmed on phones and reviewed on them; doc 01 asks for mobile-first.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0b0d10] text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
