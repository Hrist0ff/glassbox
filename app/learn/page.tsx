import type { Metadata } from "next";
import Link from "next/link";
import { StoryNav } from "@/components/story/StoryNav";
import { STORIES } from "@/lib/stories";

export const metadata: Metadata = {
  title: "Visualizations",
  description: "Step-by-step animated explanations of how networks and distributed systems work.",
};

export default function LearnIndexPage() {
  return (
    <div className="min-h-dvh bg-white font-classic text-[14px] leading-[1.428] text-[#333]">
      <StoryNav />
      <div className="mx-auto max-w-[1170px] px-[15px]">
        <h2 className="mb-2.5 mt-5 text-[30px] font-medium leading-[1.1] underline">Visualizations</h2>
        <ul>
          {STORIES.map((story) => (
            <li key={story.slug}>
              <h3 className="mb-2.5 mt-5 text-[24px] font-medium leading-[1.1]">
                <Link href={`/learn/${story.slug}`} className="text-[#2a6496] hover:text-[#1d4a70] hover:underline">
                  {story.title}: {story.subtitle}
                </Link>
              </h3>
              <p className="text-[16px] text-[#666]">{story.summary}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 italic">
          These stories are hand-written. Looking for more topics?{" "}
          <Link href="/" className="text-[#2a6496] underline hover:text-[#1d4a70]">
            Browse the Glassbox wiki
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
