import "@/app/globals.css";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";

export const metadata: Metadata = {
  title: "Tidal Cans - Seasonal Subscription Scheduler",
  description: "Dynamic subscription pricing with seasonal service windows",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main className="container mx-auto max-w-7xl px-4 pb-12">
          {children}
        </main>
      </body>
    </html>
  );
}
