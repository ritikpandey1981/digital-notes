# Final UI Consistency Patch

This patch changes desktop presentation and editor UI interaction only. History, document data,
selection semantics, manipulation, rendering, serialization, clipboard behavior, tool behavior,
package boundaries, and public package APIs remain unchanged.

## Global tooltip layer

All compact editor controls register with one document-level tooltip provider. The provider owns a
single fixed layer above floating surfaces and positions the active tooltip from its control anchor.
Existing appearance, arrow treatment, focus behavior, and 120 ms fade are preserved. Individual
widgets do not define tooltip stacking overrides.

## Floating tool widget lifecycle

Pen, Highlighter, and Shapes are registered with one internal floating-widget registry. Both widget
presentations use the same dismissal hook for outside pointer presses and Escape. Tool selection
owns which single widget is active; selecting another tool or opening More replaces or dismisses the
current widget. The active tool and retained tool settings are not changed by dismissal.

## Context hints

The status bar resolves hints through an internal registry supplied by `ContextHintProvider`; it
does not contain Select-specific branching. Phase 15 registers only:

`Tip: Alt + Click → Select object beneath`

The hint occupies a reserved status-bar slot beside the active tool, uses the existing 150 ms
content motion, and disappears for tools without a registered hint. Page, zoom, and document status
positions remain stable. Future hints can be registered without changing the status bar.

The former cursor-adjacent Alt teaching popup and its one-time local-storage state no longer exist.
Alt preview and Alt+click overlap selection behavior are unchanged.
