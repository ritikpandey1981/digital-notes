# Phase 18 — Color & Palette System

Phase 18 is complete as four additive, non-persistent subphases:

- **18A — Color Model & Workspace State:** canonical lowercase RGB Hex, RGB/HSV conversion, Recent, Favorites, immutable palettes, active-palette state, committed-artwork usage boundaries, and `ColorTargetAdapter` lifecycle.
- **18B — Quick Color Rail & Shared Picker:** creation-target Rail, responsive Full Color Picker, Current/Previous, synchronized Hex/RGB/HSV, target isolation, frame-coalesced continuous previews, and selected-vector continuous History.
- **18C — Favorites & Palette Experience:** explicit stable-order Favorites, bounded presentation, built-in palette selection/preview, and clear separation among palette, Recent, and Favorite semantics.
- **18D — Eyedropper:** picker-owned one-shot sampling from the committed composited page canvas, overlay exclusion, viewport/DPR-correct backing conversion, input arbitration, target preview, failure containment, and SecurityError-safe future-image contract.

The phase does not change PageObject or document serialization, canonical object ordering, compositor ownership, selection/manipulation/viewport architecture, brush rendering, or persistence. Selected Ink remains read-only. Colors, Recent, Favorites, palettes, active palette, picker state, and Eyedropper state remain runtime workspace state.

The next major architectural checkpoint is the Document / Persistence Architecture Decision. Phase 18 does not begin that work and does not use localStorage or a filesystem shortcut.
