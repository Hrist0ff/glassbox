import Link from "next/link";
import type { ReactNode } from "react";
import { StoryNav } from "./StoryNav";

/** A plain message page in the story style, for loading, empty, and error states. */
export function StoryMessage({
  title,
  children,
  action = { href: "/", label: "Back to the home page" },
}: {
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="min-h-dvh bg-white font-classic text-[14px] leading-[1.428] text-[#333]">
      <StoryNav />
      <div className="mx-auto max-w-[1170px] px-[15px]">
        <h1 className="mb-2.5 mt-5 text-[30px] font-medium leading-[1.1]">{title}</h1>
        <div className="max-w-2xl text-[16px] leading-relaxed">{children}</div>
        <p className="mt-6 text-[16px]">
          <Link href={action.href} className="text-[#2a6496] underline hover:text-[#1d4a70]">
            {action.label}
          </Link>
        </p>
      </div>
    </div>
  );
}
