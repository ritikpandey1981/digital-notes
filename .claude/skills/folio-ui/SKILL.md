---
name: folio-ui
description: Implement one already-approved Folio UI component without changing protected editor architecture. Not for design exploration, architecture audit, or QA-only work.
---

# Folio UI implementation

Implement one approved component and keep the scope narrow.

## Before editing

Read:

1. `AGENTS.md`;
2. the relevant sections of `docs/ARCHITECTURE.md` or `docs/DECISIONS.md` only when
   the component crosses those boundaries;
3. `docs/design/folio-design-system.md`;
4. `docs/design/drawing-tool-system.md` only when drawing tools are involved;
5. the exact approved reference/specification and the current component, neighbors,
   and tests.

If no design is approved, or it conflicts with a protected invariant, stop and report
the missing decision. Do not invent a substitute while coding.

## Implementation rules

- Adapt the approved interaction to Folio's tokens, desktop layout, and architecture.
- Use existing controllers, adapters, commands, occupied zones, dismissal stack,
  motion helpers, and `packages/ui` primitives.
- Presentation never creates a parallel document, History, selection, viewport, or
  current-color authority.
- Route color through `ColorTargetAdapter`; creation preferences are History-free and
  selected-artwork commits use the continuous-edit path.
- Keep editor UI compact and canvas-first.
- An exiting surface drops pointer events immediately.
- Implement only the authorized component; report adjacent inconsistencies.

## Verification

- Add focused tests for testable models and state transitions.
- Add or extend Electron coverage for window-only behavior.
- Run proportionate repository checks.
- Inspect the real Electron UI against the reference at normal and constrained sizes,
  including states, placement, density, keyboard use, dismissal, pointer capture, and
  reduced motion.
- Do not claim visual success from automated checks alone.

Report the implemented scope, reference match, discrepancies or conflicts, tests, gate
results, and whether manual visual approval is still required. Do not commit or push
unless asked.
