import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RealtimeProvider } from "@/components/RealtimeProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Vela",
  description: "Autonomous campus social network with 22 realistic college personas.",
  manifest: `${BASE_PATH}/manifest.json`,
  icons: {
    icon: `${BASE_PATH}/icon.svg`,
  },
  other: {
    google: "notranslate",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0D0E12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" translate="no" className={`${inter.variable} dark notranslate`}>
      <body className="bg-[#0D0E12] text-white antialiased selection:bg-[#5E5CE6]/30">
        <RealtimeProvider>{children}</RealtimeProvider>
      </body>
    </html>
  );
}
