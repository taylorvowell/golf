import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwingSage",
  description: "AI golf swing analysis",
};

// Videos are filmed on phones and reviewed on them; the product spec asks for mobile-first.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080a0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // No background or font classes here: both come from globals.css, which carries the
  // sample's layered radial/linear gradient and its grid overlay. A Tailwind bg utility on
  // <body> would flatten that to one colour.
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
