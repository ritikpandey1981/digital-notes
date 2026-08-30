# Folio Component Inventory

A **living tracker** for the UI migration. One row per significant component. It
records, separately and honestly, whether the *core capability* exists and whether the
*redesigned UI* has been designed, implemented, QA'd, and frozen.

> **The most important rule in this file:** a component is **not** design-complete
> merely because the underlying feature already works. `Core support = exists` says
> nothing about the UI columns.

Update the relevant row as part of any UI task — before starting (reference/design)
and after finishing (implementation/QA/frozen).

---

## Status Vocabulary

**Reference / Folio design columns:**
`not collected` · `reference collected` · `designing` · `approved` · `deferred`

**Core support column:**

| Value          | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `exists`       | the underlying capability is implemented and tested               |
| `core partial` | some of the capability exists; named gaps remain                  |
| `core missing` | the capability does not exist yet and must be built               |

**Implementation column:**
`not started` · `implementing` · `implemented` · `deferred`

**Manual QA column:**
`n/a` · `not started` · `QA pending` · `QA passed` · `NO-GO`

`not started` means the approved redesign has not been implemented yet, so there is
nothing to QA. `QA pending` means shipped UI exists that has never had a manual pass.

**Frozen column:**
`no` · `yes` — `yes` requires explicit user approval after manual QA.

---

## Inventory

### Shell and Document

| Component                  | Reference     | Folio design | Core support | Implementation | Manual QA  | Frozen | Notes                                                                 |
| -------------------------- | ------------- | ------------ | ------------ | -------------- | ---------- | ------ | --------------------------------------------------------------------- |
| Workspace Shell            | not collected | not collected | exists       | implemented    | QA pending | no     | Current shell predates the redesign; layout regions already correct.   |
| Top Bar                    | not collected | not collected | exists       | implemented    | QA pending | no     | Document controls only; agreed direction recorded, exact UI open.      |
| File Menu                  | not collected | not collected | core partial | implemented    | QA pending | no     | Menu bar renders; most items are placeholders pending persistence.     |
| Document Title / Save Status | not collected | not collected | core missing | not started  | n/a        | no     | Depends on persistence being wired to the sketchbook document.          |

### Drawing

| Component               | Reference          | Folio design                    | Core support | Implementation | Manual QA   | Frozen | Notes                                                                 |
| ----------------------- | ------------------ | ------------------------------- | ------------ | -------------- | ----------- | ------ | --------------------------------------------------------------------- |
| Drawing Tool System     | reference collected | approved (awaiting Claude Design) | core partial | not started    | not started | no     | `docs/design/drawing-tool-system.md`. 5 preset slots + 3 utilities. **Final UX designed independently of current implementation support.** Current dock ships; the redesign has not begun. Slot model needs a slot-keyed layer above the family-keyed brush store. |
| Tool Parameter Controls | reference collected | approved (awaiting Claude Design) | core partial | not started    | not started | no     | `docs/design/drawing-tool-system.md` §9–§11. Width/Opacity/Smoothness/Color, contextual per tool. Direct manipulation, not generic sliders. **Final UX designed independently of current implementation support.** |
| Brush Preset UI         | reference collected | approved (awaiting Claude Design) | core partial | not started    | not started | no     | `docs/design/drawing-tool-system.md` §4–§7. Stroke-preview slot identity; per-preset colour. Preference persistence does not exist yet. |
| Brush Library           | reference collected | approved (awaiting Claude Design) | core missing | not started    | not started | no     | `docs/design/drawing-tool-system.md` §8. Pencil / Pen / Colour Brush + large preview. Catalog exists; browsing surface does not. **Final UX designed independently of current implementation support.** |
| Utility Subtype Tray    | reference collected | approved (awaiting Claude Design) | core partial | not started    | not started | no     | `docs/design/drawing-tool-system.md` §16. Bottom-centre tray framework. Shapes subtypes exist; Select and Eraser modes are PLACEHOLDER CAPABILITY. |
| Dock Handedness         | reference collected | approved (awaiting Claude Design) | core missing | not started    | not started | no     | `docs/design/drawing-tool-system.md` §3. Left default, right mirror. Needs preference persistence to be remembered. |
| Eraser Controls         | reference collected | approved (awaiting Claude Design) | core partial | not started    | not started | no     | Tray placement fixed in `drawing-tool-system.md` §16.2; modes are PLACEHOLDER CAPABILITY pending a dedicated Eraser UX spec. Current controls ship. |
| Shape Controls          | reference collected | approved (awaiting Claude Design) | core partial | not started    | not started | no     | Tray placement fixed in `drawing-tool-system.md` §16.3. Line/Rectangle/Ellipse exist; Polygon and fill do not. Current widget and toolbar ship. |

### Color

| Component                        | Reference     | Folio design  | Core support | Implementation | Manual QA  | Frozen | Notes                                                                       |
| -------------------------------- | ------------- | ------------- | ------------ | -------------- | ---------- | ------ | --------------------------------------------------------------------------- |
| Color System                     | not collected | not collected | exists       | implemented    | QA pending | no     | Quick color rail, recents, favorites, palettes. Ownership must not change. The collapsed ~6-swatch stack moves into the left property strip (`drawing-tool-system.md` §13); the right-side rail becomes TEMPORARY at that point. |
| Full Color Picker                | not collected | not collected | exists       | implemented    | QA pending | no     | Transaction semantics (begin/preview/commit/cancel) are protected.           |
| Precision RGB / other controls   | not collected | not collected | core partial | implemented    | QA pending | no     | Must route through existing color targets; no second current-color store.    |
| Spectrum palette model (1A)      | n/a           | n/a           | exists       | n/a            | n/a        | n/a    | Infrastructure only — data and lookup. Not a UI. 1B is **rejected**.         |

### Layers

| Component            | Reference     | Folio design  | Core support | Implementation | Manual QA  | Frozen | Notes                                                                     |
| -------------------- | ------------- | ------------- | ------------ | -------------- | ---------- | ------ | ------------------------------------------------------------------------- |
| Layers Trigger       | not collected | not collected | exists       | implemented    | QA pending | no     | Right-hand utility rail. Fixed top-right direction agreed.                 |
| Layers Panel         | not collected | not collected | exists       | implemented    | QA pending | no     | Readable rows, thumbnails, and drag reorder polish are the redesign goals. |
| Layer Bulk Selection | not collected | not collected | core missing | not started    | n/a        | no     | Select mode; bulk Duplicate/Delete first.                                  |
| Layer Groups         | not collected | not collected | core missing | not started    | n/a        | no     | Only after Advanced Layers supports grouping correctly.                    |
| Layer Merge          | not collected | not collected | core missing | not started    | n/a        | no     | Only after Advanced Layers supports merging correctly.                     |
| Background/Paper row | not collected | not collected | exists       | not started    | n/a        | no     | Backed by `Page.paper`. **Background is not a real Layer.**                |

### Selection and Transform

| Component                      | Reference     | Folio design  | Core support | Implementation | Manual QA  | Frozen | Notes                                                        |
| ------------------------------ | ------------- | ------------- | ------------ | -------------- | ---------- | ------ | ------------------------------------------------------------ |
| Selection UI                   | not collected | not collected | exists       | implemented    | QA pending | no     | Phase 20 selection system is protected. Select-mode tray placement is fixed in `drawing-tool-system.md` §16.1; Lasso/Partial/Ignore/All are PLACEHOLDER CAPABILITY pending a dedicated Selection UX spec. |
| Transform UI                   | not collected | not collected | exists       | implemented    | QA pending | no     | Manipulation framework is protected.                          |
| Contextual Selection Controls  | not collected | not collected | exists       | implemented    | QA pending | no     | Shape editing toolbar; placement uses occupied zones.         |

### Pages and Viewport

| Component         | Reference     | Folio design  | Core support | Implementation | Manual QA  | Frozen | Notes                                          |
| ----------------- | ------------- | ------------- | ------------ | -------------- | ---------- | ------ | ---------------------------------------------- |
| Pages Navigator   | not collected | not collected | exists       | implemented    | QA pending | no     | Phase 21.                                      |
| Page Settings     | not collected | not collected | exists       | implemented    | QA pending | no     | Geometry and paper.                            |
| Canvas Navigation | not collected | not collected | exists       | implemented    | QA pending | no     | Viewport authority is protected.               |
| Zoom / Fit        | not collected | not collected | exists       | implemented    | QA pending | no     | Peripheral viewport controls.                  |
| Guides            | not collected | not collected | core missing | not started    | n/a        | no     | Rotation angle snapping exists; guides do not. |
| Precision Tools   | not collected | not collected | core partial | not started    | n/a        | no     | Some measurement exists; no precision system.  |

### Chrome and Feedback

| Component     | Reference     | Folio design  | Core support | Implementation | Manual QA  | Frozen | Notes                                     |
| ------------- | ------------- | ------------- | ------------ | -------------- | ---------- | ------ | ----------------------------------------- |
| Menus         | not collected | not collected | exists       | implemented    | QA pending | no     | Shared dropdown/context menu primitives.  |
| Notifications | not collected | not collected | exists       | implemented    | QA pending | no     |                                           |
| Dialogs       | not collected | not collected | exists       | implemented    | QA pending | no     | Keep modal use rare and small.            |

### Content Types

| Component | Reference     | Folio design  | Core support | Implementation | Manual QA | Frozen | Notes                                              |
| --------- | ------------- | ------------- | ------------ | -------------- | --------- | ------ | -------------------------------------------------- |
| Text UI   | not collected | not collected | core missing | not started    | n/a       | no     | No text `PageObject` type exists.                  |
| Image UI  | not collected | not collected | core missing | not started    | n/a       | no     | No image `PageObject` type exists.                 |
| PDF UI    | not collected | not collected | core missing | not started    | n/a       | no     | Depends on image/document import work.             |
| Import    | not collected | not collected | core missing | not started    | n/a       | no     |                                                    |
| Export    | not collected | not collected | core missing | not started    | n/a       | no     | Layers Export/Share UI blocked on this.            |

### Persistence

| Component            | Reference     | Folio design  | Core support | Implementation | Manual QA | Frozen | Notes                                                                       |
| -------------------- | ------------- | ------------- | ------------ | -------------- | --------- | ------ | --------------------------------------------------------------------------- |
| Persistence          | not collected | not collected | core partial | not started    | n/a       | no     | `@folio/persistence` exists but is not yet wired to `SketchbookDocument`.    |
| Open                 | not collected | not collected | core partial | not started    | n/a       | no     | Load pipeline exists; no editor integration or UI.                           |
| Save                 | not collected | not collected | core partial | not started    | n/a       | no     | Save pipeline and atomic write exist; no editor integration or UI.           |
| Save As              | not collected | not collected | core missing | not started    | n/a       | no     |                                                                             |
| Autosave / recovery  | not collected | not collected | core partial | not started    | n/a       | no     | Scheduler, dirty tracker and recovery exist; not wired to the editor.        |

### Cross-cutting Passes

| Component                        | Reference     | Folio design  | Core support | Implementation | Manual QA | Frozen | Notes                                                   |
| -------------------------------- | ------------- | ------------- | ------------ | -------------- | --------- | ------ | ------------------------------------------------------- |
| Keyboard shortcut UI             | not collected | not collected | core partial | not started    | n/a       | no     | Shortcuts exist; there is no discoverability surface.   |
| Stylus / gesture UX              | not collected | not collected | core partial | not started    | n/a       | no     | Pressure and pointer handling exist; gestures are thin. |
| Accessibility pass               | n/a           | not collected | core partial | not started    | n/a       | no     | Run after component redesigns land.                     |
| Minimum-window pass              | n/a           | not collected | core partial | not started    | n/a       | no     | Occupied-zone architecture exists; policy is open.      |
| Performance pass                 | n/a           | n/a           | exists       | not started    | n/a       | no     |                                                         |
| Final visual consistency pass    | n/a           | not collected | n/a          | not started    | n/a       | no     | Last gate before 1.0 validation.                        |
| Sketchbook Pro 1.0 validation    | n/a           | n/a           | n/a          | not started    | n/a       | no     | Standalone release validation.                          |

### Future Product Surfaces (not started, documented for boundary clarity)

| Component            | Reference     | Folio design  | Core support | Implementation | Manual QA | Frozen | Notes                                                        |
| -------------------- | ------------- | ------------- | ------------ | -------------- | --------- | ------ | ------------------------------------------------------------ |
| Learning/Practice UI | not collected | not collected | core missing | not started    | n/a       | no     | Future client of the editor platform.                        |
| Teaching overlays    | not collected | not collected | core missing | not started    | n/a       | no     | Transient by default; never silent document mutation.        |
| AI Coach UI          | not collected | not collected | core missing | not started    | n/a       | no     | No AI implementation is authorized yet.                      |
| AI guidance overlays | not collected | not collected | core missing | not started    | n/a       | no     | Enters History only via explicit user acceptance.            |

---

## Temporary UI Register

Temporary compatibility UI must be listed here with the component it is waiting on, and
removed once its replacement is functional.

| Temporary UI | Introduced for | Replaced by | Status |
| ------------ | -------------- | ----------- | ------ |
| _(none recorded)_ | | | |
