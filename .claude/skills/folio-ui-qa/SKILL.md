---
name: folio-ui-qa
description: Read-only validation of one implemented Folio UI component before freeze, combining focused gates, Electron visual comparison, canvas/input safety, console, and performance.
---

# Folio UI QA

Validate one implemented component. Do not implement or redesign it during this audit.

## Context

Read `AGENTS.md`, the relevant design document, the approved component reference, and
the current implementation/tests. Without an approved standard, report that visual
conformance cannot be decided.

## Checks

1. Run focused tests, then the proportionate gates from `AGENTS.md`.
2. Inspect the real Electron application at normal and constrained window sizes.
3. Compare placement, dimensions, density, spacing, hierarchy, typography, icons,
   states, motion, and transient behavior to the approved reference.
4. Check keyboard focus, semantics, reduced motion, disabled states, and neighboring
   open surfaces.
5. Exercise first stroke/selection/shape input after dismissal, Escape, wheel ownership,
   pointer capture, page presses, and workspace-surround presses where relevant.
6. Check for new console errors, whole-workspace rerenders, pointer-move React churn,
   excessive DOM/canvas work, and listener leaks.

Electron pointer tests require foreground focus; rerun an apparent focus failure alone
before diagnosing a product regression. Green automation is necessary but does not
replace human visual approval.

## Output

Report gate results, a specific visual comparison, canvas/input safety, console and
performance findings, and remaining manual approval. End with exactly one:

- `PASS`
- `PASS WITH DEFERRED VISUAL NOTES`
- `NO-GO`
