"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Explanations play full-screen in the story player, which brings its own
 * minimal navbar: the hand-written stories (/learn) and every explanation,
 * saved in this browser or bundled with the app.
 */
const BARE = /^\/learn(?:\/|$)|^\/(?:concept|demo)\//;
const isBare = (pathname: string) => BARE.test(pathname);

export function SiteChrome({ header, footer, children }: { header: ReactNode; footer: ReactNode; children: ReactNode }) {
  const bare = isBare(usePathname());
  return (
    <>
      {bare ? null : header}
      <main id="main" className="flex-1">
        {children}
      </main>
      {bare ? null : footer}
    </>
  );
}
