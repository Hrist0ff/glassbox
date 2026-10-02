export function SectionHeading({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <div>
      <h2 id={id} className="font-display text-3xl tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
    </div>
  );
}
