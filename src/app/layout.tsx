import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Data Model Hub",
  description: "Interactive platform for visualizing, designing, and managing Entity-Relationship data models across multiple project solutions.",
  keywords: ["data model", "ER diagram", "entity relationship", "database design", "schema visualization"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
