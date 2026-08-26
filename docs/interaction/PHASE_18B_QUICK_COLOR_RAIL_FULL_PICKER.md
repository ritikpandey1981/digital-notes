# Phase 18B — Quick Color Rail and Shared Full Picker

## Scope

Phase 18B adds a workspace-scoped Quick Color Rail and one Full Color Picker presentation. It uses the Phase 18A canonical lowercase six-digit Hex model, active palette catalog, Recent Colors session state, isolated brush families, Shape creation state, and selected-vector continuous edit boundary.

Favorites and user-palette management remain Phase 18C work. Eyedropper remains Phase 18D work. No Phase 18B color UI is persisted.

## Target and session ownership

`EditorWorkspace` owns one picker session. Every entry point supplies a concrete `ColorTargetAdapter` with a stable identity and useful label:

- Pencil, Pen, Marker, and Highlighter adapters read and update only that brush family's active preset state. Preview, commit, and cancel create no History entries.
- The Shape creation adapter reads and updates only `ShapeToolState.style.strokeColor`. It does not touch selected vectors and creates no History entries.
- A selected Line, Rectangle, or Ellipse adapter wraps the existing `ContinuousVectorStyleEdit` actions. Multiple previews create one command at most on commit; cancel restores the exact original style with zero commands.

Changing tool family, selected object, or color capability invalidates and cancels the previous target. Window blur, unmount, and Escape also cancel. Normal outside dismissal flushes the latest scheduled sample and commits. A canvas-page outside pointer commits synchronously without preventing the pointer, so its first click can select another object.

## Preview scheduling

The picker updates its local Current, Hex, RGB, SV indicator, and hue immediately. Raw SV and hue previews use a latest-value-per-animation-frame boundary before reaching a target. Commit flushes a pending value first. Cancel drops a pending value before restoring the target. Text, palette, and RGB changes use immediate canonical previews inside the same transaction.

## Quick Color Rail

The Rail appears at workspace right-center for Pencil, Pen, Marker, Highlighter, and Shapes. It is absent for Select and Eraser. It contains:

1. the active creation target's Current Color trigger;
2. up to seven colors from the active palette;
3. a More Colors trigger for the shared picker.

The Rail never recolors a selection. Palette swatches are single-click creation-style changes with zero History entries. At short heights, a deterministic capacity function reduces the swatch count; the Rail never scrolls. The selected-vector toolbar treats the Rail's right-side strip as an occupied collision zone.

The Rail is a vertical toolbar with roving focus. Arrow keys move between buttons, Home and End move to the extremes, and Enter/Space use native button activation. Each color has a canonical Hex accessible name, `aria-pressed` exposes active color state, focus rings are visible, and global Folio tooltips appear on hover or focus.

## Full Picker

All three entry points reuse `FullColorPicker`:

- Quick Color Rail;
- compact Color row in Tool Settings;
- selected-vector contextual toolbar.

The panel contains SV, hue, Current/Previous, Hex, RGB, Recent Colors (up to ten), the entire active palette, and a built-in Basic/Sketch/Monochrome selector. Current and Previous are captured separately: Previous is the target color at session begin and remains fixed during preview.

Hex accepts an optional leading `#` only when six digits are complete. Incomplete/invalid drafts do not reach a target. Enter normalizes valid input; blur normalizes valid input and restores Current for invalid input. RGB accepts only finite integer channels from 0–255. Hex, RGB, and HSV remain synchronized.

The session remembers its last meaningful hue. Moving through gray or black therefore preserves the hue used when saturation returns instead of resetting the hue control.

Before Phase 19, the picker placement policy was tightened without changing color semantics. The surface is collision-clamped to the usable editor workspace, reserves the bottom-right viewport controls, and uses an internally scrollable body when the Electron minimum window cannot show its natural height. Selected-vector sessions additionally use the authoritative `ShapeEditingSnapshot.viewportBounds` as an avoid rectangle: legal zero-overlap candidates are preferred, otherwise the deterministic least-overlap candidate is used. The top bar, Quick Color Rail, viewport controls, page camera, and selected artwork are not moved to create space.

Recent Colors are not picker-trigger history. They continue to be reported only by actual committed artwork creation or committed selected-vector recolor through the existing `CanvasSurface.onArtworkColorUsed` boundary.

## Floating ownership and accessibility

The picker participates in the existing `data-floating-widget-scope` / `data-floating-widget-owner` protocol. Tool Settings owns a picker opened from its Color row; the picker owns the portaled built-in palette menu. Owner attributes accept a whitespace-separated scope list so a portaled descendant can belong to both levels. No global click suppression or timer workaround is used.

The SV field deliberately does not claim one-dimensional ARIA slider semantics. It is a labeled, focusable two-dimensional group. Left/Right adjust saturation, Up/Down adjust value, and Shift uses a larger step. Equivalent labeled Hex and RGB inputs provide complete keyboard and screen-reader editing. Hue uses native range slider semantics.

## Selection presentation

Canvas vector frames, handles, hover feedback, and general selection outlines now use the semantic Folio selection violet (`#7669c2`) instead of the previous hardcoded blue. Selected Ink/group feedback retains its visible bounds but uses a nearly transparent violet fill so the artwork color remains readable.

## Persistence classification

Phase 18B workspace colors, Recent Colors, active palette choice, Rail state, picker state, Previous, and hue memory are session-only. No persistence schema, serializer, autosave, or recovery code changes in this phase.

## Visual QA states

The Phase 18B Electron scenario captures ten implementation screenshots: Pencil Rail, Shapes Rail, Select with Rail hidden, picker from Rail, Hex/RGB state, built-in palette dropdown, picker from Pencil settings, picker from selected Rectangle, short-window Rail, and selected Ink semantic selection feedback.
