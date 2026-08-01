# Task C — Shape Interaction & Editing Refinement

Task C is an editor-interaction refinement. It does not change the document model, History,
transactions, selection ownership, manipulation contracts, rendering architecture, serialization,
clipboard behavior, package graph, or public package APIs.

## Overlapping selection

Normal click continues to use the existing editor hit-test engine and selects its deterministic
top-most result. While Alt is held, the editor queries that same engine for every selectable result
under the pointer and presents the next candidate without changing selection. Alt+click commits the
presented candidate and advances the session-local candidate cursor. Releasing Alt clears the cursor.

Candidate order is z-index descending with object identity as the stable tie-breaker. Invisible and
locked objects are excluded. The hover overlay consumes the same candidate query, so its emphasis
matches the object a normal click or Alt+click will select.

Discoverability is provided by the desktop status bar's persistent Context Hint while Select is
active: `Tip: Alt + Click → Select object beneath`. The earlier cursor-adjacent teaching popup and
its local-storage state were removed. The hint remains presentation-only and never enters the
document or History.

## Line endpoint editing

A selected line exposes two endpoint handles and one midpoint handle. Endpoint hit regions are
screen-stable. Dragging an endpoint calculates a new immutable absolute transform around the line's
existing local pivot while preserving the opposite endpoint's world position. The editor adapts the
completed gesture to the existing rotation, scale, and translation manipulation results and commits
them through one existing History transaction. Consequently, endpoint editing is one atomic
undo/redo step without adding a command or changing transaction semantics.

The midpoint delegates to the existing translation manipulation unchanged. No line rotation handle
or rotation interaction is introduced. Temporary previews, active-endpoint emphasis, cursor state,
and measurements remain presentation-only.

## Measurements

- Circle: radius and diameter.
- Ellipse: width and height.
- Rectangle: width and height.
- Line: length and mathematical counter-clockwise angle.

The same editor-owned measurement formatter is used by shape creation and line endpoint previews.
Measurements disappear on commit or cancellation and are neither serialized nor recorded in
History.

## Drawing width fidelity

Pen and Highlighter share configurable continuous width constraints with a 0.5–40 px range. Mouse,
wheel, keyboard, slider, and numeric input continue to use the same descriptor values. The stroke
preview receives the mounted canvas viewport scale through the existing rendering diagnostics
callback and converts document-space width to the same screen-space width used by the canvas.
Finalized mouse strokes retain the selected base width because mouse pressure normalizes to 0.5.

## Ownership and lifecycle

All new interaction state is session-local to `CanvasSurface` and is destroyed with the mounted
editor session. Temporary overlay renderers remain demand-driven. Pointer capture, cancellation,
tool changes, Alt release, and component cleanup clear their corresponding previews and listeners.
