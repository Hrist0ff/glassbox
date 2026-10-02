import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted">Not found</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-ink">This explanation isn&apos;t available</h1>
      <p className="mt-4 leading-relaxed text-ink-soft">
        Check the link. It may point to something that was never saved, or that has been removed.
      </p>
      <Link href="/#explore" className="mt-8 inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-ink/85">
        Browse explanations
      </Link>
    </div>
  );
}
