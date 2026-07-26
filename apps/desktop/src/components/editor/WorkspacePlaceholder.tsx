import { MoreHorizontal } from "lucide-react";

export function WorkspacePlaceholder() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden px-6 pb-6 pt-20">
      <div className="notebook-stage" data-testid="notebook-stage">
        <div className="notebook-page-stack" aria-hidden="true" />
        <article className="notebook-page" aria-label="Placeholder notebook page">
          <header className="flex items-start justify-between border-b border-folio-page-rule px-9 pb-4 pt-8">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-folio-page-muted">
                Sunday · July 26
              </p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-folio-page-ink">
                Project reflections
              </h1>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-folio-page-muted transition-colors hover:bg-black/5 hover:text-folio-page-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
              aria-label="Page options placeholder"
              title="Page options placeholder"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </header>

          <div className="paper-lines relative flex-1 px-9 py-7 text-folio-page-ink">
            <p className="max-w-[82%] text-[13px] leading-7">
              A quiet place for ideas, observations, sketches, and everything still taking shape.
            </p>
            <div className="mt-6 space-y-3" aria-hidden="true">
              <div className="h-1.5 w-[72%] rounded-full bg-folio-page-mark/20" />
              <div className="h-1.5 w-[88%] rounded-full bg-folio-page-mark/15" />
              <div className="h-1.5 w-[63%] rounded-full bg-folio-page-mark/15" />
            </div>
            <div className="mt-10 flex items-center gap-3 text-[11px] text-folio-page-muted">
              <span className="size-1.5 rounded-full bg-folio-accent" aria-hidden="true" />
              Shell preview · editing is intentionally unavailable
            </div>
          </div>

          <footer className="flex items-center justify-between px-9 pb-6 text-[10px] text-folio-page-muted">
            <span>Studio Notes</span>
            <span>1</span>
          </footer>
        </article>
      </div>
    </div>
  );
}
