import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import { SiteChrome } from "@/components/SiteChrome";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Glassbox — see how it works, one change at a time", template: "%s · Glassbox" },
  description:
    "Step through animated explanations of how things work, what happened, and how options compare, from a topic or from your own notes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-paper"
        >
          Skip to content
        </a>
        <SiteChrome
          header={<SiteHeader />}
          footer={
            <footer className="border-t border-line">
              <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p>
                  Glassbox is open source under the MIT license. AI-generated explanations are labeled and can contain mistakes.
                </p>
                <Link href="/#how-it-works" className="font-medium text-ink-soft underline-offset-4 hover:underline">
                  How explanations are made
                </Link>
              </div>
            </footer>
          }
        >
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
