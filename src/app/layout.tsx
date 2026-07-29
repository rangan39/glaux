import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap"
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap"
});

const azeretMono = Azeret_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-azeret-mono",
  display: "swap"
});

export const metadata: Metadata = {
  applicationName: "Sophon",
  title: {
    default: "Sophon",
    template: "%s · Sophon"
  },
  description: "An open-source, multilingual AI web tool that runs locally in your browser with WebGPU.",
  category: "developer tools"
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f8fbff",
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} ${instrumentSerif.variable} ${azeretMono.variable} antialiased`}>
        <TooltipProvider delayDuration={120}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
