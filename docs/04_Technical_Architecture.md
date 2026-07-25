# FOLIO

# Volume 4 – Technical Architecture & Engineering Specification

### Version 2.0

---

# 1. Architecture Philosophy

The software must be:

- Fast
- Offline-first
- Easy to maintain
- Modular
- Extensible
- Cross-platform ready

The architecture should allow future additions like cloud sync or AI without requiring a rewrite.

---

# 2. Technology Stack

## Desktop Framework

Electron

Reason:

- Mature ecosystem
- Windows support
- Large developer community
- Easy packaging
- Can later support macOS and Linux

---

## Frontend

React 19

Reason:

- Component-based architecture
- Large ecosystem
- Easy state management
- Excellent tooling

---

## Language

TypeScript

Reason:

- Type safety
- Better maintainability
- Easier debugging
- Better Codex output

---

## Styling

Tailwind CSS

Component Library

shadcn/ui

Animation

Framer Motion

---

## Drawing Engine

HTML5 Canvas

Vector-based stroke system

Reason:

Fast

Hardware accelerated

Supports pressure-sensitive drawing

Supports zoom

Supports thousands of strokes

---

## Local Database

SQLite

Used for:

Notebook index

Metadata

Search

Settings

Recent files

---

## Assets

Notebook pages

Images

Thumbnails

Stored inside project folders.

---

# 3. High-Level Architecture

```
+------------------------------------------------------+
|                   Electron Desktop                   |
+------------------------------------------------------+
|                  React Application                   |
+------------------------------------------------------+
|               UI Components Layer                    |
+------------------------------------------------------+
| Notebook Manager | Editor | Toolbar | Search         |
+------------------------------------------------------+
|           Core Application Services                  |
|  File System | Rendering | Storage | History         |
+------------------------------------------------------+
| SQLite | Local Files | Assets | Export Engine        |
+------------------------------------------------------+
```

---

# 4. Project Structure

```
folio/

├── src/
│
├── app/
│
├── components/
│     Button
│     Toolbar
│     Sidebar
│     Notebook
│     Page
│     Canvas
│
├── features/
│     notebooks
│     editor
│     search
│     export
│     bookmarks
│     settings
│
├── services/
│     fileSystem
│     autosave
│     storage
│     renderer
│     history
│
├── hooks/
│
├── stores/
│
├── utils/
│
├── types/
│
├── assets/
│
└── styles/
```

Every feature should live in its own module.

Avoid one giant "editor.tsx" file.

---

# 5. Core Modules

The application is divided into independent systems.

### Notebook Module

Responsible for:

Notebook creation

Rename

Delete

Metadata

Covers

Import

Export

---

### Page Module

Responsible for:

Page navigation

Page creation

Templates

Ordering

Bookmarks

---

### Canvas Module

Responsible for:

Rendering

Drawing

Selection

Zoom

Pan

Objects

---

### Text Module

Responsible for:

Rich text

Formatting

Lists

Tables

Links

---

### Search Module

Responsible for:

Indexing

Searching

Highlighting

Results

---

### Export Module

Responsible for:

PDF

Images

Native format

---

### Settings Module

Responsible for:

Themes

Shortcuts

Preferences

Updates

---

# 6. Object-Based Design

Every item on the page is treated as an object.

```
Page

↓

Objects

↓

Text

Image

Stroke

Shape

Table

Sticky Note

Bookmark

Audio (future)
```

Every object must support:

Selection

Move

Copy

Paste

Resize (where applicable)

Delete

Lock

Grouping

Layer ordering

Serialization

This avoids creating special-case logic for each content type.

---

# 7. State Management

Use a centralized state store (for example, Zustand).

Separate:

- UI state
- Notebook state
- Editor state
- Settings state
- History state

Keep transient UI state separate from persisted notebook data.

---

# 8. Rendering Pipeline

Drawing follows this flow:

```
Stylus

↓

Input Manager

↓

Stroke Processor

↓

Stroke Smoothing

↓

Canvas Renderer

↓

GPU

↓

Screen
```

Only redraw the regions that changed rather than repainting the entire canvas whenever possible.

---

# 9. History System

Every edit creates a history command.

Example:

```
Add Text

↓

History Stack

↓

Undo

↓

Redo
```

Prefer a command-based history instead of saving entire page snapshots after every edit.

---

# 10. File Structure

Each notebook is a folder.

Example:

```
Physics Notebook/

cover.png

thumbnail.png

metadata.json

pages/

001.page

002.page

003.page

assets/

image1.png

image2.jpg

audio/

(optional)

history/
```

This makes notebooks portable and easier to recover if something becomes corrupted.

---

# 11. Page Format

Each page stores structured data, for example:

```
{
  "pageId":"001",
  "background":"ruled",
  "objects": [
    {
      "type":"text",
      "id":"obj1"
    },
    {
      "type":"stroke",
      "id":"obj2"
    },
    {
      "type":"image",
      "id":"obj3"
    }
  ]
}
```

Avoid storing everything in one large blob.

---

# 12. Autosave

Trigger autosave:

- After a few seconds of inactivity
- When switching pages
- Before closing the app
- Before export

Use atomic writes (write to a temporary file, then replace the original) to reduce the chance of data corruption.

---

# 13. Search Engine

Index:

Notebook titles

Page titles

Text

Tags

Bookmarks

Recent notebooks

Search should operate on the local index rather than scanning every file on each query.

---

# 14. Performance Strategy

Targets:

- Startup under 2 seconds
- Notebook open under 500 ms
- Page switch under 100 ms
- Smooth scrolling
- Smooth zoom
- Low-latency drawing

Strategies:

- Lazy-load notebooks
- Cache thumbnails
- Virtualize long page lists
- Load images on demand
- Defer non-essential work until after the UI is responsive

---

# 15. Error Handling

Never crash because of a malformed notebook.

If one page is corrupted:

- Skip the page
- Show an error message
- Keep the rest of the notebook usable

Log recoverable errors for debugging.

---

# 16. Security

Even though this is a local app:

- Validate imported files
- Sanitize pasted HTML
- Restrict file access to intended locations
- Avoid executing arbitrary scripts from notebook content

---

# 17. Logging

Maintain logs for:

- Crashes
- Autosave failures
- Export failures
- File import issues

Use concise, readable log messages.

---

# 18. Testing Strategy

Before each release:

- Create notebook
- Delete notebook
- Duplicate notebook
- Draw 1,000+ strokes
- Insert images
- Export PDF
- Undo/redo stress test
- Open a large notebook
- Verify autosave and recovery

Automate unit tests where practical and keep a short manual checklist for user-facing workflows.

---

# 19. Versioning

Use semantic versioning:

```
2.0.0

Major → New architecture

Minor → New features

Patch → Bug fixes
```

Embed a document version inside each notebook format to simplify future migrations.

---

# 20. Development Roadmap

## Phase 1

- Electron setup
- React setup
- Tailwind
- SQLite
- Project structure

## Phase 2

- Notebook library
- Notebook creation
- Local storage

## Phase 3

- Editor shell
- Canvas
- Rich text

## Phase 4

- Pen engine
- Shapes
- Images
- Tables

## Phase 5

- Search
- Export
- Autosave

## Phase 6

- Polish
- Performance
- Animations
- Bug fixing

---

# 21. Code Standards

- Keep components focused on a single responsibility.
- Prefer composition over inheritance.
- Avoid deeply nested component trees.
- Use descriptive TypeScript interfaces.
- Write reusable hooks for shared logic.
- Keep business logic out of UI components.
- Add comments only where intent is not obvious from the code.

---

# 22. Folder Ownership

Each folder has a clear responsibility:

- `components/` → Reusable UI
- `features/` → Business logic
- `services/` → Infrastructure (storage, autosave, export)
- `stores/` → Global state
- `types/` → Shared models
- `utils/` → Pure helper functions
- `assets/` → Static resources

This separation keeps the codebase understandable as it grows.