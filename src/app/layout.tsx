import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-cormorant",
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
      <body className={`${cormorant.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
