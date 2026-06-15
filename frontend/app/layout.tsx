import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelForge Chat Studio",
  description:
    "No-code AI fine-tuning workflow platform — upload datasets, fine-tune Gemma, and deploy models.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased h-full overflow-hidden">{children}</body>
    </html>
  );
}
