# Phase 15R — Shape Foundation Review and UX Refinement

Phase 15R refines the accepted Line, Rectangle, and Ellipse foundation without changing object semantics, package ownership, or the established History, manipulation, selection, and rendering architectures.

## Unified creation workflow

The desktop Tool Dock contains one Shapes tool. Activating it opens a compact floating widget with exactly three choices: Line, Rectangle, and Ellipse. Choosing a shape sets the existing editor interaction mode; creation remains pointer-down, live immutable draft, pointer-up, and one History-backed insert. The tool and shape kind remain active after commit or cancellation.

Creation uses one crosshair cursor and exposes no color, width, or opacity palette. Shift is tracked for the complete pointer gesture, so a user can press or release it after dragging begins. Lines snap to 45-degree increments, rectangles to squares, and ellipses to circles. The temporary measurement reports line length and a positive counter-clockwise angle, or shape width by height.

## Selection and hover presentation

Rectangle and ellipse hit testing accepts any point inside the transformed geometry. Lines retain a forgiving distance-to-path tolerance. Hover feedback is editor-owned, read-only presentation state.

A selected line is represented by its highlighted path with two endpoint handles and one midpoint handle; it does not use a rectangular selection box. Rectangles and ellipses preserve the established manipulation handles and receive an outline emphasis. All hover and selection visuals are invalidation-driven and remain outside document serialization and History.

## Shape editing toolbar

One compact, content-sized horizontal shape-editing toolbar remains mounted for the editor lifetime and becomes visible for a single supported vector selection. It updates in place between vector selections, stays within the workspace viewport, and chooses a position above or below the object to reduce obstruction.

The toolbar exposes:

- Stroke color
- Stroke width
- Opacity
- Duplicate
- Delete
- A disabled More placeholder

Style changes are adapted by the editor into an immutable vector-style command and executed through the existing History controller. They use existing document factories and collection replacement operations, produce serializable successor objects, and support undo and redo. Duplicate and Delete use the established lifecycle actions.

Width and Opacity reuse the desktop's existing continuous slider inside matching animated expansion panels. The expansion primitive is generic and controlled, so future toolbar properties can reuse its trigger, panel, animation, focus, and dismissal behavior. Numeric summaries reserve a fixed field, and panels are positioned outside normal flow, so neither value updates nor expansion changes toolbar dimensions.

## Architectural boundaries

- No package dependency or manifest changed.
- History, transactions, generic command contracts, selection ownership, manipulation sessions, rendering ownership, vector serialization, and `PageObject` semantics are unchanged.
- The rendering package remains unaware of selection and History. Temporary vector interaction visuals live in the editor adapter and use the existing public canvas overlay and scheduler seams.
- The Selection package remains independent; the editor adapter owns the interior-selection policy required by the desktop workflow.
- No smart guides, extra shapes, fill controls, geometry editing, multi-selection changes, or new panel architecture were added.
