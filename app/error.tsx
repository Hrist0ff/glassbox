"use client";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 sm:px-6" role="alert">
      <h1 className="font-display text-4xl tracking-tight text-ink">Something went wrong</h1>
      <p className="mt-4 leading-relaxed text-ink-soft">The page couldn&apos;t be rendered. You can try again.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-ink/85"
      >
        Try again
      </button>
    </div>
  );
}
