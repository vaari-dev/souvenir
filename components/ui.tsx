// Furniture shared across pages, so the same thing looks the same everywhere.

export function tone(deltaC: number): string {
  return deltaC > 0 ? "text-felt" : deltaC < 0 ? "text-no-deep" : "text-soft";
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface p-8 text-center">
      <p className="display text-2xl font-bold uppercase tracking-wide">{title}</p>
      {sub && <p className="mt-1 text-sm text-soft">{sub}</p>}
    </div>
  );
}
