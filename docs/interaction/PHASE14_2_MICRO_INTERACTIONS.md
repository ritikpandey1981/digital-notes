# Phase 14.2 — Micro Interactions & Visual Polish

## Scope

Phase 14.2 refines only the desktop presentation and animation layer. It adds no tools, editor capabilities, document behavior, rendering behavior, History behavior, public APIs, dependencies, or package-graph changes. Existing layout, spacing, colors, typography, and component dimensions remain unchanged.

## Interaction language

Desktop interactions use one restrained motion policy:

- Hover feedback: 100 ms.
- Press feedback: 75 ms.
- Selection feedback: 140 ms.
- Context Palette open: 190 ms.
- Context Palette close: 160 ms.
- Configurable-tool content change: 150 ms.
- Notification open/close: 180/150 ms.
- Cursor changes: immediate.

Transform motion uses one professional ease-out curve. Operating-system reduced-motion preference collapses Framer Motion transitions, while the existing global reduced-motion rule collapses CSS transitions and keyframes.

## Tool Dock

Dock buttons retain their fixed 36-pixel geometry. Hover changes surface and text color without scaling the button, so icons do not jump. Press feedback uses a short transform that does not affect layout. Every tool owns a permanently mounted selection layer whose opacity and shadow transition over 140 ms; switching tools therefore avoids abrupt background replacement or indicator remounting. Focus remains visible through the existing accent ring.

The dock retains its existing permanent elevation and dimensions. The temporary Context Palette uses the existing stronger overlay elevation, preserving a consistent light source without changing layout.

## Context Tool Palette

The accepted mounted-container architecture remains unchanged. Palette entry uses a 190 ms fade and eight-pixel horizontal movement. Exit uses a shorter 160 ms fade and six-pixel movement. Pen-to-Highlighter changes animate only the descriptor-driven contents over 150 ms. All transitions remain interruptible during rapid switching.

Outside dismissal, retained tool settings, canvas lifetime, and the More menu lifecycle remain unchanged from Phase 14.1.

## Controls and preview

Sliders, numeric inputs, color controls, menu items, shell buttons, dialog actions, and notification dismissal use the same short hover, press, and focus language. Slider hit areas and value semantics are unchanged. Thumb emphasis is limited to transform and shadow, so rapid values remain immediate rather than trailing an animated position.

Preset-color and recent-color rings now transition their shadow instead of switching abruptly. Recent swatches can enter, leave, and reorder without moving surrounding layout. All color buttons expose their selected state through `aria-pressed`.

The live stroke preview keeps its existing Canvas2D drawing path. It now retains the HiDPI backing store whenever its physical size is unchanged, avoiding an unnecessary context reset on every width, opacity, or color update. Preview drawing remains synchronous and uses the same immutable descriptor input.

## Performance and regression protection

No motion is connected to the editor render loop. Cursor changes remain synchronous, slider values remain continuous, canvas objects remain mounted, and no continuous animation is introduced. Motion is limited to compositor-friendly opacity and transform changes plus short color and shadow transitions.

Unit coverage locks the timing policy and reduced-motion conversion. Electron coverage verifies fixed dock geometry during hover and rapid switching, focus visibility, selected-tool state, palette elevation and mounted continuity, color-ring transition behavior, slider hit area, cursor changes, repeated open/close, drawing, resize, undo/redo, and mounted-canvas continuity. The existing professional-ink scenario continues to cover rapid input and cached final rendering.
