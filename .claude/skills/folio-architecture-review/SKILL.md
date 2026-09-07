---
name: folio-architecture-review
description: Read-only audit of Folio's document, History, session, color, rendering, input, and future-client boundaries. Never fixes findings.
---

# Folio architecture review

Audit only. Do not modify files, including “trivial” fixes. Read code rather than
trusting summaries, and cite file/line evidence for every finding.

The authoritative checklist is `AGENTS.md`, `docs/ARCHITECTURE.md`, and
`docs/DECISIONS.md`.

## Verify

- `PageObject` has no page/layer ownership; Layers own ordered IDs.
- `PageDocument` keeps Layers and canonical flattened `ObjectCollection` atomic.
- Immutable replacement, canonical ordering, and command-based History survive.
- One logical gesture has one logical entry; previews/cancel are coherent.
- active page/layer, viewport, selection, tools, and transient UI remain session state.
- current color remains behind tool/selection targets; `EditorColorSystem` owns only
  recents/favorites/palettes.
- the unified compositor, coordinate converter, viewport authority, and input capture
  remain singular.
- UI mutations pass through controllers/adapters and commands.
- transient learning/AI state cannot silently become artwork.

For each finding give severity, invariant, location, observed behavior, and concrete
consequence:

- S0 Critical: data model, canonical order, or History correctness is compromised.
- S1 Major: an authority is bypassed or duplicated.
- S2 Moderate: a package or state boundary is materially blurred.
- S3 Minor: localized divergence with limited blast radius.
- Upgrade suggestion: improvement, not a defect.

Report `CORE INTACT` or `CORE COMPROMISED`, ranked findings, audited areas found clean,
and anything not verifiable. Recommend fixes, but do not make them.
