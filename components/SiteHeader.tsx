import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5 rounded-md" aria-label="Glassbox home">
          <Logo />
          <span className="font-display text-xl tracking-tight text-ink">Glassbox</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/#explore" className="rounded-full px-3 py-2 font-medium text-ink-soft hover:bg-paper-sunk hover:text-ink">
            Explore
          </Link>
          <Link href="/learn" className="rounded-full px-3 py-2 font-medium text-ink-soft hover:bg-paper-sunk hover:text-ink">
            Visualizations
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="8" fill="#1c1a17" />
      <circle cx="8.5" cy="18.5" r="3.2" fill="#fdfcf9" />
      <circle cx="19.5" cy="9.5" r="3.2" fill="none" stroke="#fdfcf9" strokeWidth="1.8" />
      <path d="M11 16.2 L16.6 11.4" stroke="#8fa7f5" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="13.8" cy="13.8" r="1.6" fill="#8fa7f5" />
    </svg>
  );
}
