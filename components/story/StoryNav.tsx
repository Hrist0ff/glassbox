import Link from "next/link";
import type { ReactNode } from "react";

/** Plain top bar in the style of the original's Bootstrap 3 navbar. */
export function StoryNav({ children }: { children?: ReactNode }) {
  return (
    <nav
      aria-label="Story"
      className="relative z-30 flex h-[50px] shrink-0 items-center justify-between border-b border-[#e7e7e7] bg-[#f8f8f8] px-[15px]"
    >
      <Link href="/" className="text-[18px] leading-[20px] text-[#666] hover:text-[#333] focus-visible:text-[#333]">
        Glassbox
      </Link>
      {children}
    </nav>
  );
}
