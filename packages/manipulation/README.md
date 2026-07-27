# @folio/manipulation

`@folio/manipulation` owns Folio's framework-independent object-manipulation sessions. Phase 10 implements translation only: normalized page-space input moves one selected immutable object through an explicit Preparing/Dragging/Committing-or-Cancelling state machine.

The package has production dependencies only on `@folio/selection` and `@folio/document`. It has no React, Electron, rendering, history, persistence, or UI dependency. It neither owns document objects nor renders pixels; the editor queries its immutable state and composes those responsibilities.

## Public API

- `createManipulationController()` creates the editor-facing interaction coordinator.
- `createManipulationManager()` creates the sole owner of an active session and state transitions.
- `createTranslationEngine()` creates the origin-relative page-space calculation strategy.
- `DEFAULT_MANIPULATION_CONFIGURATION` exposes the frozen centralized drag threshold.
- Type-only interfaces describe controller/manager contracts, state, commits, sources, pointer input, translation, and configuration.

Concrete controllers, managers, sessions, state builders, and translation implementations remain private. Factories are the required construction seam.

## Package structure

```text
packages/manipulation/
|-- README.md
|-- package.json
|-- tsconfig.json
`-- src/
    |-- __tests__/
    |-- controller/manipulation-controller.ts
    |-- interfaces/
    |   |-- manipulation-controller.ts
    |   |-- manipulation-manager.ts
    |   |-- manipulation-session.ts
    |   `-- translation-engine.ts
    |-- manager/manipulation-manager.ts
    |-- model/types.ts
    |-- session/manipulation-session.ts
    |-- state/manipulation-state.ts
    |-- translation/translation-engine.ts
    `-- index.ts
```

## Invariants

- Only one session exists per manager.
- Pointer ownership is identified by the initiating pointer ID.
- Translation is always `current page point - initial page point`; event deltas never accumulate.
- A session stays Preparing through the exact threshold and enters Dragging only after it is exceeded.
- State contains object identity and interaction values, never copied objects or stroke geometry.
- Commit is requested through an injected editor callback; rejection or failure cancels safely.
- Selection identity and object visibility, lock, and existence are revalidated throughout the session.
- Commit/cancel terminal states are observable before the manager returns to Idle.
- Destroying a controller cancels its active session and retains no document state.

See `docs/architecture/PHASE10_MANIPULATION_ARCHITECTURE.md` for the complete integration contract.
