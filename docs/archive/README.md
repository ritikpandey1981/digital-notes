# Documentation archive

This directory contains superseded planning material preserved for historical context.
Archived files are not implementation authority and may describe obsolete product
framing, package boundaries, APIs, phases, or completion status. Current source, tests,
and active documentation outrank everything here.

Agents must not load this directory during normal implementation work. Read it only
when the user asks for history or current sources cannot resolve a contradiction.

- `legacy-volumes/`: the complete original numbered volumes — product vision, design
  system, feature specification, technical architecture, engineering task book, UI
  blueprint, and development standards. The task book's phase order and the standards'
  folder, state, and content-model rules describe an earlier plan and an earlier
  codebase; both are superseded by `AGENTS.md` and the active documents below.
- `architecture-snapshots/`: large point-in-time architecture manuals retained for
  archaeology.
- `screenshots/`: historical visual evidence captured during earlier work, kept after
  the reports that referenced it were retired. These images record what the application
  looked like on the day they were taken, not what it should look like now. Never treat
  one as a current design requirement or a visual baseline; current product and design
  truth comes from the active documents together with current source and tests. The
  phase names in the subdirectories are historical labels only.

Use the active documentation instead:

- [`../../AGENTS.md`](../../AGENTS.md) — repository operating rules
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — implemented architecture
- [`../DECISIONS.md`](../DECISIONS.md) — durable decisions
- [`../ROADMAP.md`](../ROADMAP.md) — verified gaps and future work
- [`../design/folio-design-system.md`](../design/folio-design-system.md) — design system
- [`../design/drawing-tool-system.md`](../design/drawing-tool-system.md) — drawing tools
