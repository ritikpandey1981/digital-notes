# Phase 10 — Object Manipulation Architecture

## Architecture overview

Phase 10 adds translation-only movement for one selected immutable page object. The new `@folio/manipulation` package owns the logical interaction lifecycle and origin-relative translation calculation. It never receives browser events, screen coordinates, viewport state, rendering objects, or writable document objects.

The editor remains the composition boundary. It routes the Move tool, converts browser screen coordinates through rendering's canonical converter, supplies normalized page points to manipulation, maps immutable state to a renderer-owned preview, and commits one immutable replacement to its active document session.

## Package responsibilities

| Package | Phase 10 responsibility | Explicitly does not own |
| --- | --- | --- |
| Application | Exposes Move in the existing toolbar and selects editor mode | Sessions, math, rendering |
| Editor | Browser adapter, coordinate bridge, package composition, immutable replacement | Translation algorithm, preview pixels, viewport math |
| Manipulation | Session lifecycle, pointer ownership, threshold, translation state, commit/cancel decision | React, Electron, rendering, history, persistence |
| Selection | Reports the single selected object identity | Manipulation sessions |
| Document | Creates and validates immutable translated replacement objects | Drag lifecycle |
| Ink | Reuses stroke geometry for permanent ink and preview visual adapters | Manipulation state |
| Rendering | Owns transparent preview pixels, clipping, HiDPI transforms, scheduling, invalidation | Manipulation decisions or documents |

## Dependency graph

```mermaid
flowchart TD
    Application["Application shell"] --> Editor["@folio/editor"]
    Editor --> Manipulation["@folio/manipulation"]
    Manipulation --> Selection["@folio/selection"]
    Manipulation --> Document["@folio/document"]
    Selection --> Document
    Document --> Domain["@folio/domain"]
    Editor --> Rendering["@folio/rendering"]
    Editor --> Ink["@folio/ink"]
    Ink --> Rendering

    History["@folio/history"]
    Persistence["@folio/persistence"]
    Manipulation -. "no dependency" .-> History
    Manipulation -. "no dependency" .-> Persistence
    Manipulation -. "no dependency" .-> Rendering
```

`@folio/manipulation` production dependencies are exactly `@folio/selection` and `@folio/document`. Rendering has no dependency on manipulation.

## Class diagram

```mermaid
classDiagram
    class ManipulationController {
        <<interface>>
        +handlePointer(input)
        +beginManipulation(pointerId, position)
        +updateManipulation(pointerId, position)
        +commitManipulation(pointerId, position)
        +cancelManipulation(pointerId)
        +hasActiveSession()
        +getManipulationState()
        +subscribe(listener)
        +destroy()
    }
    class ManipulationManager {
        <<interface>>
        +beginSession(input)
        +updateSession(position)
        +commitSession()
        +cancelSession()
        +getState()
        +hasActiveSession()
        +subscribe(listener)
    }
    class TranslationEngine {
        <<interface>>
        +calculate(origin, current)
    }
    class ManipulationState {
        <<immutable>>
        +phase
        +sessionId
        +objectId
        +pointerId
        +dragOrigin
        +currentPointerPosition
        +initialObjectTranslation
        +translation
        +finalObjectTranslation
        +version
    }
    class ManipulationSessionImplementation {
        <<private>>
    }
    class TranslationPreviewRenderer {
        +setPreview(target)
        +redraw()
        +forceRender()
        +snapshot()
        +destroy()
    }

    ManipulationController --> ManipulationManager
    ManipulationManager --> ManipulationSessionImplementation
    ManipulationSessionImplementation --> TranslationEngine
    ManipulationSessionImplementation --> ManipulationState
    ManipulationController ..> ManipulationState
    ManipulationState ..> TranslationPreviewRenderer : Editor adapts
```

Only interfaces, utility types, centralized configuration, and factories are exported from manipulation. Concrete controller, manager, session, and translation classes remain private.

## Manipulation session state machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Preparing: valid primary pointer down
    Preparing --> Preparing: movement at or below threshold
    Preparing --> Dragging: movement exceeds threshold
    Dragging --> Dragging: pointer update
    Dragging --> Committing: valid pointer up and editor accepts replacement
    Committing --> Idle: session released
    Preparing --> Cancelling: pointer cancel or non-drag release
    Dragging --> Cancelling: cancel, invalid context, or rejected commit
    Cancelling --> Idle: session released
```

Illegal or repeated transitions return the existing state reference. Only one session and one pointer ID can own interaction at a time.

## Pointer interaction sequence

```mermaid
sequenceDiagram
    participant Browser
    participant Editor
    participant Manipulation
    participant Selection
    participant Rendering
    participant Document

    Browser->>Editor: primary pointer down (screen)
    Editor->>Editor: canonical screen-to-page conversion
    Editor->>Manipulation: normalized down (page)
    Manipulation->>Selection: read selected identity
    Manipulation->>Document: resolve visible, unlocked object
    Manipulation-->>Editor: Preparing state
    Editor->>Browser: capture pointer
    Browser->>Editor: pointer moves, including outside canvas
    Editor->>Manipulation: normalized move (page)
    Manipulation-->>Editor: Dragging + absolute translation
    Editor->>Rendering: set translated preview
    Browser->>Editor: pointer up
    Editor->>Manipulation: normalized up (page)
    Manipulation->>Editor: immutable commit request
    Editor->>Document: create and replace translated object
    Editor->>Rendering: update permanent visual and clear preview
    Editor->>Browser: release capture
    Manipulation-->>Editor: Idle
```

## Coordinate systems

```mermaid
flowchart LR
    Screen["Browser screen coordinates"] --> Canvas["Logical canvas coordinates"]
    Canvas --> Viewport["Viewport coordinates"]
    Viewport --> World["World coordinates"]
    World --> Page["Page-local coordinates"]
    Page --> Manipulation["Manipulation input and translation"]
```

The editor calls `CoordinateConverter.screenToPage()`. Session starts are clipped to the active page. Once pointer capture belongs to a session, page coordinates outside page bounds remain valid so movement continues without discontinuity. Device-pixel ratio affects only the canvas backing store, never logical translation values.

## Translation algorithm

For every accepted update:

```text
movement.x = currentPointer.x - dragOrigin.x
movement.y = currentPointer.y - dragOrigin.y
distance   = hypot(movement.x, movement.y)

finalObjectTranslation = initialObjectTranslation + movement
```

All values use page units. Deltas are never accumulated, so event frequency and frame rate cannot introduce numerical drift. The original object and stroke remain untouched during the session.

## Preview lifecycle

```mermaid
flowchart LR
    Preparing["Preparing: no preview"] --> Dragging["Dragging state"]
    Dragging --> Cached["Editor reuses cached StrokeVisual"]
    Cached --> Preview["TranslationPreviewRenderer.setPreview"]
    Preview --> Dirty["Invalidate previous and current bounds"]
    Dirty --> RAF["One coalesced animation frame"]
    RAF --> Overlay["Clipped HiDPI transparent overlay"]
    Overlay --> Terminal{"Commit or cancel"}
    Terminal --> Clear["setPreview(null)"]
    Clear --> Idle["Transparent overlay idle; no repaint loop"]
```

Preview input contains identity, raw bounds, absolute page translation, and a visual interface. Rendering never reads selection, manipulation state, or document objects. The base page and permanent ink canvases are unchanged while dragging.

## Commit sequence

```mermaid
sequenceDiagram
    participant Controller
    participant Editor
    participant ObjectFactory
    participant Collection
    participant PermanentInk
    participant Preview

    Controller->>Editor: ManipulationCommit
    Editor->>ObjectFactory: translateObject(original, movementVector)
    ObjectFactory-->>Editor: new same-ID immutable InkObject
    Editor->>Collection: replace(new object)
    Editor->>PermanentInk: set absolute stroke translation
    PermanentInk->>PermanentInk: redraw union of old/new bounds
    Controller->>Controller: Committing -> Idle
    Editor->>Preview: setPreview(null)
```

Exactly one replacement is created for a successful drag. Stroke geometry is retained by reference. No history or persistence operation is invoked.

## Cancel sequence

```mermaid
sequenceDiagram
    participant Browser
    participant Editor
    participant Controller
    participant Preview
    participant Document

    Browser->>Editor: pointercancel, capture loss, mode/context change, or teardown
    Editor->>Controller: cancelManipulation(pointerId)
    Controller-->>Editor: Cancelling -> Idle
    Editor->>Preview: setPreview(null)
    Editor->>Browser: release pointer capture
    Note over Document: No replacement and no mutation
```

Failed preconditions are ignored. A removed, hidden, or locked object, changed selection context, or rejected commit returns safely to Idle. Editor-owned pointer capture is explicitly released on commit, cancel, context change, and teardown.

## Public APIs

The manipulation runtime surface is deliberately limited to:

- `createManipulationController`
- `createManipulationManager`
- `createTranslationEngine`
- `DEFAULT_MANIPULATION_CONFIGURATION`

Public type contracts include `ManipulationController`, `ManipulationManager`, `TranslationEngine`, immutable state and commit types, normalized pointer input, selection/object sources, and configuration. `CanvasSurface` adds the type-only `move` interaction mode plus optional interface/state callbacks; it remains the editor package's only runtime export.

## Extension points

- A future transformation model can extend the immutable session payload while preserving controller/manager/session ownership.
- Replaceable calculation interfaces can add resize, rotation, scale, skew, or group strategies.
- Identity-only object lookup naturally supports future multi-object identities without storing mutable objects in a session.
- `TranslationPreviewVisual` permits new object visuals without giving rendering document knowledge.
- Commit remains an editor callback, leaving future history wrapping outside manipulation.

No resize, rotation, scale, snapping, alignment, history, persistence, clipboard, keyboard, touch-gesture, or multi-selection behavior is implemented in Phase 10.

## Design rationale and performance

Origin-relative math is deterministic and avoids drift. Immutable state references make notification ownership explicit. Object lookup uses existing maps, sessions retain identity rather than documents, stroke preview retains one immutable geometry reference, animation-frame scheduling coalesces pointer bursts, duplicate dirty bounds are discarded, and old/current dirty bounds avoid full-page repaint. Focused tests exercise documents containing 100, 1,000, and 5,000 objects without inventing wall-clock benchmark claims.
