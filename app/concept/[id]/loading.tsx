export default function LoadingConcept() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6" aria-busy="true" aria-label="Loading explanation">
      <div className="h-4 w-32 animate-pulse rounded bg-paper-sunk" />
      <div className="mt-8 h-9 w-2/3 max-w-xl animate-pulse rounded bg-paper-sunk" />
      <div className="mt-4 h-5 w-full max-w-2xl animate-pulse rounded bg-paper-sunk" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="aspect-[5/3] animate-pulse rounded-2xl border border-line bg-paper-raised" />
        <div className="space-y-3">
          <div className="h-3 w-full animate-pulse rounded bg-paper-sunk" />
          <div className="h-20 w-full animate-pulse rounded bg-paper-sunk" />
          <div className="h-11 w-full animate-pulse rounded-full bg-paper-sunk" />
        </div>
      </div>
    </div>
  );
}
