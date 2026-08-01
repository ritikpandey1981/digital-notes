# Task A — Shape Toolbar and Widget Polish

Task A is a desktop-presentation refinement. It changes no editor contract, package dependency, rendering behavior, document state, History behavior, manipulation behavior, selection behavior, or public API.

## Stable toolbar geometry

Every expandable numeric trigger uses the shared `ExpandableToolbarSection` summary field. The field has fixed tabular width and accommodates formatted values through `1000.0 px`; changing between short and long values therefore cannot change toolbar width. Desktop composition also retains the toolbar anchor during style-only immutable object replacements, while real selection, object-position, transform, and viewport changes continue to reposition it normally.

## Shared continuous controls

Width and Opacity both reuse the existing `ContinuousSlider`. They share the same expandable panel, animation, focus treatment, mouse, wheel, keyboard, numeric-input, Escape, and outside-pointer behavior. Selecting one section replaces the other without remounting the toolbar. No second slider implementation exists.

## Shapes widget and spacing

The Shapes widget is 56 pixels wide and 126 pixels high, approximately 12–14% smaller than its previous footprint. Its three actions remain 36-pixel desktop targets. Reduced padding, gaps, and 16-pixel icons make the widget visually lighter without altering its tool behavior.

The Shape Editing Toolbar uses equal horizontal padding, four-pixel inter-control gaps, aligned 32-pixel actions, matching separators, and its existing Folio glass surface, radius, border, and shadow. Expandable panels remain outside layout flow, preventing toolbar size changes.

## Verification boundary

Automated Electron coverage measures stable toolbar width and position through real Width changes at 0.5, 7, 30, and 8.3 pixels. A capacity check verifies the same geometry for formatted labels at 125 and 1000 pixels. Electron visual inspection covers the reduced Shapes widget and both expanded slider panels.
