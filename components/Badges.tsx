type BadgeKind = "curated" | "ai_generated" | "bundled";

const STYLES: Record<BadgeKind, { label: string; className: string; icon: string }> = {
  curated: { label: "Curated", className: "bg-success-soft text-success", icon: "✓" },
  ai_generated: { label: "AI-generated", className: "bg-[#eee6fc] text-[#5b2bb5]", icon: "✦" },
  bundled: { label: "Example", className: "bg-warning-soft text-warning", icon: "▣" },
};

export function Badge({ kind }: { kind: BadgeKind }) {
  const style = STYLES[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
      <span aria-hidden>{style.icon}</span>
      {style.label}
    </span>
  );
}
