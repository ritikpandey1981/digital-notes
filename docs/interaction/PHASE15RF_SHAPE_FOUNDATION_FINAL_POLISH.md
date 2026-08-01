# Phase 15RF — Shape Foundation Final Polish

Phase 15RF is a presentation-only refinement of the accepted shape foundation. It changes no document semantics, serialized data, command behavior, History lifecycle, manipulation behavior, package dependency, or runtime public API.

## Layout consistency

The Tool Dock keeps its permanent 48-pixel width but now derives its height from its controls. Equal top and bottom padding replace the previous reserved footer space. The Shape Editing Toolbar likewise uses its natural content width rather than a fixed card width while preserving viewport clamping, horizontal spacing, border, radius, glass surface, and shadow.

## Reusable expandable controls

Shape Width and Opacity use the same `ContinuousSlider` component as Pen and Highlighter. Selecting either property opens an animated panel below the toolbar with continuous mouse, wheel, keyboard, focus, and numeric-input behavior. Updates continue through the existing immutable shape-style action and History path.

The toolbar expansion mechanism is a reusable controlled desktop component. It owns the common trigger semantics, `aria` relationship, motion profile, absolute panel layout, outside-pointer dismissal, and Escape dismissal. Numeric summaries use a fixed tabular field sized for values through `1000.0 px`. Opening a section or changing a value does not resize or remount the toolbar. No Fill, Corner Radius, Dash Style, or other future expandable section is implemented.

## Selection presentation

Shape selection uses the existing selection renderer's style input and the editor-owned vector interaction overlay. A less saturated accent, thinner outline, and softer highlight reduce visual dominance without changing handle size, hit testing, or manipulation targets.

## Shift handling and platform boundary

During active shape creation, Folio prevents Chromium's default handling for Shift keydown and keyup while preserving the established constraint semantics. Repeated keydown events do not schedule redundant preview work. The Windows five-Shift Sticky Keys prompt is owned by the operating system and cannot be disabled by renderer event handling; Folio does not install a global keyboard hook or change the user's accessibility settings.

## Preserved boundaries

- No package manifest or dependency changed.
- No public API changed.
- No History, rendering, selection, manipulation, document, serialization, clipboard, or tool-registry architecture changed.
- No new property, shape, guide, snapping, or editing feature was added.
