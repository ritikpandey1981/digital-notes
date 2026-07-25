# FOLIO

# Volume 5 – Engineering Task Book

### Version 2.0

## Development Principles

Every task must:

- Build on the previous task.
- Compile successfully before moving to the next.
- Include basic error handling.
- Maintain the existing UI quality.
- Avoid breaking completed features.

Each task ends with a checklist and a manual test.

---

# Phase 1 – Project Foundation

## Task 1.1 – Create Project

Objective:

Create the base Electron + React + TypeScript project.

Deliverables:

- Electron configured
- React application running
- TypeScript configured
- Tailwind CSS installed
- ESLint and Prettier configured
- Build scripts working

Definition of Done:

- `npm run dev` launches the desktop application.
- Hot reload works.
- No TypeScript errors.

---

## Task 1.2 – Folder Structure

Create:

```
app/
components/
features/
services/
stores/
hooks/
types/
utils/
assets/
styles/
```

Definition of Done:

- Every folder exists.
- Import aliases are configured.
- Path aliases are working.

---

## Task 1.3 – Design System

Create reusable components:

- Button
- Card
- Dialog
- Input
- Dropdown
- Sidebar
- Toolbar
- Context Menu
- Scroll Area

Definition of Done:

- Every component follows Volume 2.
- Light and dark themes work.

---

# Phase 2 – Notebook Library

## Task 2.1 – Sidebar

Build:

- Library
- Favorites
- Recent
- Tags
- Trash
- Settings

Definition of Done:

- Sidebar collapses.
- Smooth animation.
- Navigation works.

---

## Task 2.2 – Notebook Cards

Implement:

- Grid layout
- Notebook covers
- Hover effects
- Context menu
- Selection

Definition of Done:

- Cards animate smoothly.
- Multiple notebooks display correctly.

---

## Task 2.3 – Create Notebook Dialog

User can select:

- Title
- Cover
- Paper Type
- Theme
- Notebook Size

Definition of Done:

- Notebook appears immediately in library.
- Metadata saved correctly.

---

# Phase 3 – Editor

## Task 3.1 – Editor Layout

Build:

- Toolbar
- Workspace
- Page
- Status Bar
- Right Panel

Definition of Done:

- Layout matches Volume 2.

---

## Task 3.2 – Page Renderer

Implement:

- Page
- Margins
- Paper textures
- Shadows
- Zoom

Definition of Done:

- Notebook visually resembles a premium notebook.

---

## Task 3.3 – Page Navigation

Implement:

- Add Page
- Delete Page
- Duplicate
- Move
- Bookmark

Definition of Done:

- Navigation updates correctly.

---

# Phase 4 – Drawing Engine

## Task 4.1 – Canvas

Implement:

- Canvas
- Zoom
- Pan

Definition of Done:

- Smooth rendering.

---

## Task 4.2 – Ink

Implement:

- Pen
- Pencil
- Marker
- Highlighter
- Eraser

Definition of Done:

- Mouse drawing works.
- Stylus support works if available.

---

## Task 4.3 – Stroke Engine

Implement:

- Pressure
- Smoothing
- Vector storage

Definition of Done:

- No visible lag.
- Strokes remain crisp when zooming.

---

# Phase 5 – Rich Content

## Task 5.1 – Text

Implement:

- Rich text
- Formatting
- Lists
- Quotes

---

## Task 5.2 – Images

Implement:

- Drag and drop
- Resize
- Rotate
- Crop

---

## Task 5.3 – Tables

Implement:

- Insert
- Resize
- Merge cells

---

## Task 5.4 – Shapes

Implement:

- Rectangle
- Circle
- Arrow
- Triangle
- Line

---

# Phase 6 – Object System

## Task 6.1 – Selection

Objects should support:

- Select
- Multi-select
- Move
- Delete

---

## Task 6.2 – Layers

Implement:

- Bring Forward
- Send Backward
- Lock
- Hide

---

## Task 6.3 – Clipboard

Implement:

- Copy
- Cut
- Paste
- Duplicate

---

# Phase 7 – Search & Organization

## Task 7.1 – Search

Search:

- Notebook
- Page
- Text
- Bookmark

---

## Task 7.2 – Tags

Implement:

- Add
- Remove
- Filter

---

## Task 7.3 – Bookmarks

Implement:

- Colored tabs
- Jump to page

---

# Phase 8 – File System

## Task 8.1 – Save

Implement:

- Save
- Save As

---

## Task 8.2 – Autosave

Implement:

- Automatic saves
- Recovery

---

## Task 8.3 – Notebook Format

Implement:

- `.folio`
- Import
- Export

---

# Phase 9 – Export

## Task 9.1 – PDF

Export:

- Current page
- Page range
- Entire notebook

---

## Task 9.2 – Images

Export:

- PNG
- JPG

---

# Phase 10 – Settings

Implement:

- Theme
- Accent color
- Shortcuts
- Defaults

---

# Phase 11 – Polish

Improve:

- Animations
- Shadows
- Hover effects
- Transitions
- Loading states
- Empty states

---

# Phase 12 – Testing

Run through:

- Create notebook
- Delete notebook
- Draw continuously
- Insert images
- Export PDF
- Undo/redo stress test
- Large notebook performance
- Autosave recovery

Fix issues before adding new functionality.

---

# Final Release Checklist

Before calling Version 2.0 complete:

- No TypeScript errors.
- No console warnings during normal use.
- All major workflows tested.
- Stable autosave.
- Smooth UI interactions.
- Consistent design language.
- Performance meets the targets from Volume 4.