import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "./Badges";

export type ConceptCardData = {
  href: string;
  title: string;
  description: string;
  /** e.g. "8 steps" or "7 chapters". */
  length: string;
  origin: "curated" | "ai_generated";
  bundled?: boolean;
  /** Decorative picture of the explanation, drawn in the story style. */
  thumbnail?: ReactNode;
};

/** `action` is drawn over the card's top-right corner, outside the link, e.g. a delete button. */
export function ConceptCard({ card, action }: { card: ConceptCardData; action?: ReactNode }) {
  return (
    <li className="relative h-full">
      <Link
        href={card.href}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_14px_30px_-22px_rgba(30,25,15,0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {card.thumbnail ? <div className="border-b border-line">{card.thumbnail}</div> : null}
        <div className="flex flex-1 flex-col p-5">
          <div className="flex flex-wrap gap-1.5">
            {card.bundled ? <Badge kind="bundled" /> : null}
            <Badge kind={card.origin} />
          </div>
          <h3 className="mt-3 font-display text-xl leading-snug text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
            {card.title}
          </h3>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">{card.description}</p>
          <p className="mt-auto pt-4 text-xs font-medium text-ink-muted">
            {card.length} <span aria-hidden>→</span>
          </p>
        </div>
      </Link>
      {action ? <div className="absolute right-3 top-3">{action}</div> : null}
    </li>
  );
}
