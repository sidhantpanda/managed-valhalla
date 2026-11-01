import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// Archivo's width axis gives condensed map-label names and normal-width body text from one family.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Valhalla regions",
  description: "Choose which parts of the world geo-engine's Valhalla can route in, and rebuild its tiles.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
