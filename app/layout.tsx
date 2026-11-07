import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crosspost Studio",
  description: "Your creative space for video, photo and text. Prepare, preview and publish to your Facebook Page.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
