# Phase 13.2 — Final Editor UX Polish

Status: implemented as the final interaction-quality pass over the frozen Phase 13.1 editor architecture.

## Scope

Phase 13.2 changes only toolbar composition, ink path quality, cursor presentation, and selection-handle usability. History, commands, documents, transforms, clipboard, Selection, Manipulation, keyboard shortcuts, context menus, package boundaries, and public exports remain unchanged.

## Handle-driven toolbar

The desktop toolbar no longer presents Move, Rotate, or Scale buttons. Select remains the universal manipulation tool:

- dragging the selected interior moves;
- dragging a corner handle scales; and
- dragging the upper circular handle rotates.

The removal is limited to the toolbar tool array. Compatible canvas interaction modes remain available, and the retained controls rebalance without placeholder gaps.

## Smooth ink paths

The ink renderer converts sampled stroke points into bounded Catmull–Rom-derived cubic Bézier segments. Each segment starts and ends on its corresponding samples, preserving stroke order and both endpoints. Control points are clamped to the rectangle formed by the segment endpoints; because a cubic curve remains inside the convex hull of its controls, this prevents spatial overshoot and suppresses oscillation around sharp samples.

Live input draws only newly sampled segments, preserving immediate feedback and avoiding whole-stroke work on every pointer update. On finalization, the renderer replaces the live preview once with the complete smooth path. Immutable cubic segment data is cached alongside the renderer's retained immutable stroke reference and reused for later redraws and transform updates. Pressure remains evaluated from the original endpoint samples, preserving compatibility with variable-width ink.

The document `Stroke`, its sampled points, bounds, style, and serialization remain unchanged. Undo, redo, transforms, duplicate, delete, and clipboard continue operating on the same immutable object.

## Cursor feedback

| Interaction state | Cursor |
| --- | --- |
| Selection interior hover | Native open hand (`grab`) |
| Translation pointer-down/drag | Native closed hand (`grabbing`) |
| Top-left or bottom-right handle | `nwse-resize` |
| Top-right or bottom-left handle | `nesw-resize` |
| Rotation handle | Inline circular-arrow SVG with `crosshair` fallback |
| Outside selection | `default` |

The circular cursor is a package-private presentation asset. Semantic cursor state is kept separate from its CSS representation so tests and diagnostics do not depend on browser URL normalization. Hovering remains command-free and does not modify selection, documents, or History.

## Handle usability

Selection visuals retain their existing outline, fill, shapes, and spacing. Corner squares and the circular rotation handle increase from 8 to 10 logical viewport pixels. Editor hit testing uses a separate 12-pixel radius, allowing activation slightly beyond the visible handle without enlarging the overlay excessively. Both values remain zoom-independent in screen space.

## Architecture boundaries

- The desktop shell owns toolbar composition.
- The editor adapter owns cursor state and zoom-aware handle hit policy.
- The existing selection overlay renderer owns only its visual handle size.
- The ink renderer owns only path construction, cached render geometry, and drawing.
- No renderer imports History, commands, Selection logic, Manipulation, or clipboard state.
- No new package dependency or public API is introduced.

## Verification coverage

Unit coverage verifies bounded curve controls, endpoint preservation, one- and two-point strokes, fast and slow sampling, large strokes, pressure-aware rendering, rotation-cursor resolution, grab/grabbing CSS, enlarged screen-stable hit areas, accidental-hit rejection, and 10-pixel handle visuals.

Electron coverage verifies the simplified toolbar, finalized cubic rendering diagnostics, real cursor transitions, closed-hand drag feedback, cursor reset, group move/scale/rotate, activation outside the visible resize square, History neutrality during hover, and all existing editor workflows.
