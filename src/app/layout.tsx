import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archive — AI Fashion Broker",
  description:
    "Upload an outfit photo or describe your aesthetic. Get a structured style audit and shoppable product recommendations instantly.",
  keywords: [
    "fashion",
    "style audit",
    "AI stylist",
    "outfit feedback",
    "shopping recommendations",
  ],
  openGraph: {
    title: "Archive — AI Fashion Broker",
    description: "Get instant style audits and shoppable recommendations.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
