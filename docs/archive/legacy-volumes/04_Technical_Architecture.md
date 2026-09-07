# FOLIO

# =============================================================================

# Technical Architecture & Engineering Specification

# Version : 2.1

# Status : Approved for Implementation

# 

# This document defines the complete software architecture of Folio.

# It serves as the single source of truth for all engineering decisions.

# 

# Audience

# 

# Software Engineers

# Codex

# Technical Architects

# Future Contributors

# 

# =============================================================================

# Revision History

| Version | Date | Description |
| --- | --- | --- |
| 2.0 | Initial Draft | Initial architecture |
| 2.1 | Current | Major architectural redesign after engineering review |

# Table of Contents

1. Architecture Philosophy
2. Technology Stack
3. High-Level Architecture
4. Electron Process Architecture
5. Project Structure
6. Domain Model
7. Object Capability Model
8. State Management
9. Persistence Architecture
10. Native File Format
11. Search Architecture
12. Rendering Architecture
13. Undo / Redo
14. Autosave
15. Security
16. Performance
17. Testing
18. Build Pipeline
19. Release Pipeline
20. Development Roadmap

# ==============================================================================
Chapter 1
Architecture Philosophy

## 1.1 Purpose

Folio is designed as a premium notebook application rather than a productivity
suite.

The architecture must support three goals above everything else:

1. Excellent writing experience
2. Long-term maintainability
3. Predictable performance

Every architectural decision should improve at least one of these goals
without significantly degrading the others.

---

## 1.2 Core Principles

### Principle 1

The Notebook is the Product.

Users should always feel they are interacting with a notebook rather than
a collection of software features.

The notebook remains the central object throughout the application.

### Principle 2

Offline First

The application must function without an internet connection.

No feature should require cloud services for normal operation.

Internet connectivity may be used in future versions for synchronization,
but the local notebook remains the authoritative copy.

### Principle 3

Files are the Source of Truth

Notebook content is never stored exclusively inside SQLite.

Notebook files always represent the canonical data.

SQLite only exists to accelerate operations.

If SQLite becomes corrupted it can always be rebuilt from notebook files.

### Principle 4

Reliability before Features

A notebook that never loses user data is more valuable than one containing
twenty additional features.

Persistence, recovery and autosave are therefore implemented before advanced
editing features.

### Principle 5

Composition over Inheritance

Objects should not inherit behavior they do not require.

Instead they compose capabilities from small reusable interfaces.

This dramatically reduces coupling.

### Principle 6

Strict Layer Separation

Business logic

must never know

how UI works.

Rendering

must never know

how persistence works.

Storage

must never know

how drawing works.

Every layer communicates only through well-defined interfaces.

---

## 1.3 Architectural Goals

The architecture is optimized for

- Maintainability
- Extensibility
- Predictability
- Testability
- Performance
- Fault tolerance
- Accessibility
- Security

---

## 1.4 Non Goals

The following are intentionally outside Version 2.

- Real-time collaboration
- Cloud synchronization
- AI assistants
- Browser version
- Mobile version
- Plugin ecosystem

The architecture should allow these in the future but they are not
implementation targets.

---

## 1.5 Engineering Priorities

Priority 1
Data Integrity

Priority 2
Low Latency Ink

Priority 3
Reliable Autosave

Priority 4
Responsive UI

Priority 5
Modular Codebase

Priority 6
Visual Polish

==============================================================================

Chapter 2
Technology Stack

==============================================================================

## 2.1 Overview

The selected technologies prioritize long-term stability, TypeScript support,
desktop performance and developer productivity.

| Layer | Technology |
| --- | --- |
| Desktop Runtime | Electron |
| Frontend | React 19 |
| Language | TypeScript |
| Styling | TailwindCSS |
| UI Components | shadcn/ui |
| Animations | Framer Motion |
| State | Zustand |
| Drawing | HTML5 Canvas |
| Database | SQLite |
| Search | SQLite FTS |
| Build | Vite |
| Testing | Vitest + Playwright |
| Linting | ESLint |
| Formatting | Prettier |

---

## 2.2 Why Electron

Electron provides

- Native desktop integration
- Stable Windows APIs
- File system access
- Automatic updates
- Cross-platform future

Although Electron consumes more memory than native applications, the trade-off
is acceptable for maintainability and ecosystem maturity.

---

## 2.3 Why React

React provides

- Mature ecosystem
- Component architecture
- Excellent TypeScript support
- Predictable rendering
- Large community

The notebook itself is not rendered using the DOM.

React manages application UI only.

Canvas renders notebook pages.

---

## 2.4 Why TypeScript

Entire project uses strict TypeScript.

Benefits

- Compile-time validation
- Better refactoring
- Strong contracts
- Better Codex generation
- Fewer runtime bugs

Rules

Strict Mode

No implicit any

No disabled compiler checks

---

## 2.5 Why SQLite

SQLite is NOT the notebook database.

SQLite stores

- Search index
- Recent files
- Cached thumbnails
- Metadata cache

Notebook pages remain stored as JSON files.

SQLite can be deleted without data loss.

---

## 2.6 Rendering Technology

Notebook pages are rendered with

HTML5 Canvas

Reasons

- High performance
- Freeform drawing
- Stylus support
- Smooth zoom
- Low latency

React never renders page objects directly.

==============================================================================

Chapter 3
High-Level System Architecture

==============================================================================

The application follows a layered architecture.

```
                +----------------------+
                |     React UI         |
                +----------+-----------+
                           |
                +----------v-----------+
                | Application Services |
                +----------+-----------+
                           |
                +----------v-----------+
                | Domain Model         |
                +----------+-----------+
                           |
                +----------v-----------+
                | Persistence Layer    |
                +----------+-----------+
                           |
           +---------------+----------------+
           |                                |
  Notebook Files                    SQLite Cache
           |                                |
           +---------------+----------------+
                           |
                      Local Storage
```

Rules

Every layer depends only on the layer below.

No circular dependencies are allowed.

==============================================================================

Chapter 4
Electron Architecture

==============================================================================

Electron consists of three isolated processes.

+-------------------------------------------------------------+

Main Process

---

Window Creation

---

Native Menus

---

File Dialogs

---

Auto Updates

---

OS Integration

---

+-------------------------------------------------------------+

---

```
                ▲

                │ IPC

                ▼
```

+-------------------------------------------------------------+

Preload

---

Safe API Bridge

---

Input Validation

---

IPC Wrappers

---

+-------------------------------------------------------------+

---

```
                ▲

                │

                ▼
```

+-------------------------------------------------------------+

Renderer

---

React

---

Canvas

---

Editor

---

Panels

---

UI

---

+-------------------------------------------------------------+

---

Security Rules

Renderer

- No direct filesystem access
- No Node.js APIs
- No unrestricted IPC

Main Process

- Owns filesystem
- Owns dialogs
- Owns native APIs

Preload

- Exposes minimal API surface
- Validates requests
- Rejects malformed payloads

==============================================================================

Chapter 5
Project Structure

==============================================================================

folio/

│

├── apps/

│   └── desktop/

│

├── packages/

│   ├── ui/

│   ├── editor/

│   ├── domain/

│   ├── persistence/

│   ├── rendering/

│   ├── search/

│   ├── shared/

│   └── testing/

│

├── assets/

├── docs/

├── scripts/

├── tools/

└── tests/

Package Responsibilities

ui/
Reusable React components.

editor/
Editor orchestration.

domain/
Business models.

rendering/
Canvas rendering engine.

persistence/
Notebook loading and saving.

search/
SQLite indexing.

shared/
Utility functions.

testing/
Test helpers and fixtures.

---

Architecture Decision Record 001

Decision

Notebook files are the canonical source of truth.

Reason

This allows notebooks to remain readable, portable,
recoverable and independent from SQLite.

Consequences

Pros

- Human readable
• Easier backup
• Easy import/export
• Better corruption recovery

Cons

- Slightly slower searches

Resolution

Accepted

Status

Permanent

---

# =============================================================================

# Chapter 6

# Domain Model

# =============================================================================

## 6.1 Overview

The Domain Model defines the core business objects used throughout Folio.

These objects represent notebook data only.

They do not contain UI logic.

They do not know how they are rendered.

They do not know how they are saved.

This separation allows the same data model to be reused by different rendering
engines or future platforms.

---

## 6.2 Domain Hierarchy

```
Workspace
│
├── Notebook
│   ├── Metadata
│   ├── Sections
│   ├── Assets
│   └── Settings
│
├── Section
│   └── Pages
│
├── Page
│   └── Page Objects
│
└── Assets
```

---

## 6.3 Notebook

A Notebook is the highest-level user document.

Responsibilities

- Store notebook metadata
- Organize sections
- Manage notebook settings
- Reference notebook assets

Properties

```tsx
Notebook

id
name
createdAt
updatedAt
cover
theme
sections[]
settings
```

---

## 6.4 Section

A Section groups related pages.

Responsibilities

- Organize pages
- Preserve ordering
- Store section metadata

Properties

```tsx
Section

id
title
pages[]
color
icon
```

---

## 6.5 Page

A Page represents one physical notebook page.

Pages are fixed size.

Pages can be zoomed.

Pages cannot become infinite canvases.

Properties

```tsx
Page

id
width
height
background
objects[]
createdAt
updatedAt
```

---

## 6.6 Page Object

Everything drawn or inserted onto a page is represented as a PageObject.

Examples

- Ink stroke
- Text
- Image
- Shape
- Sticky note
- Table

Every object has a unique identifier.

Every object can be serialized.

---

## 6.7 Object Categories

Drawing Objects

- Pen Stroke
- Highlighter

Text Objects

- Rich Text
- Heading

Media Objects

- Image

Layout Objects

- Table
- Sticky Note

Graphics

- Rectangle
- Circle
- Line
- Arrow

Future

- Audio
- Video
- Formula
- Code Block

---

# =============================================================================

# Chapter 7

# Object Capability System

# =============================================================================

## 7.1 Overview

Instead of creating a deep inheritance hierarchy, Folio uses composition.

Every object owns only the capabilities it needs.

Example

Instead of

```
Object
    ↓
GraphicObject
    ↓
Rectangle
```

Folio uses

```
Rectangle

+ Renderable

+ Movable

+ Resizable

+ Serializable

+ Selectable
```

This keeps the architecture modular.

---

## 7.2 Available Capabilities

Selectable

Allows user selection.

---

Movable

Allows dragging.

---

Resizable

Allows resizing.

---

Rotatable

Allows rotation.

---

Editable

Allows editing.

---

Serializable

Allows save/load.

---

Renderable

Allows drawing on canvas.

---

Lockable

Prevents editing.

---

Groupable

Allows grouping.

---

Searchable

Allows indexing.

---

## 7.3 Example

Ink Stroke

Capabilities

✓ Renderable

✓ Serializable

✓ Selectable

✓ Lockable

✗ Resizable

✗ Editable

---

Image

Capabilities

✓ Renderable

✓ Serializable

✓ Selectable

✓ Resizable

✓ Rotatable

✓ Lockable

---

Rich Text

Capabilities

✓ Renderable

✓ Serializable

✓ Editable

✓ Selectable

✓ Searchable

---

Benefits

- Less duplicated code
- Easier testing
- Easier maintenance
- Better scalability

---

# =============================================================================

# Chapter 8

# State Management

# =============================================================================

## 8.1 Philosophy

React state is not used to store notebook data.

Notebook data lives in dedicated stores.

React displays state.

It does not own state.

---

## 8.2 Zustand Stores

The application uses multiple stores instead of one global store.

Stores

Notebook Store

Current notebook

---

Editor Store

Selection

Zoom

Clipboard

History

---

UI Store

Theme

Panels

Dialogs

Notifications

---

Settings Store

Preferences

Shortcuts

Appearance

---

Search Store

Index

Results

Filters

---

## 8.3 Data Flow

```
User Action

↓

Store Update

↓

Business Logic

↓

Canvas Refresh

↓

React UI Update
```

---

## 8.4 Rules

Never mutate objects directly.

Always use store actions.

All updates should be predictable.

---

# =============================================================================

# Chapter 9

# Persistence Architecture

# =============================================================================

## 9.1 Overview

Persistence is responsible for safely storing notebook data.

Notebook files are the authoritative data source.

SQLite is not.

---

## 9.2 Storage Layout

```
Notebook/

metadata.json

sections/

pages/

assets/

thumbnails/

search.db
```

---

## 9.3 Save Pipeline

```
User Edit

↓

Command

↓

Update Domain Model

↓

Mark Dirty

↓

Autosave Queue

↓

Write JSON

↓

Update Search Index
```

---

## 9.4 Loading Pipeline

```
Open Notebook

↓

Read metadata.json

↓

Read Sections

↓

Read Pages

↓

Load Assets

↓

Build Search Index

↓

Display Notebook
```

---

## 9.5 Autosave

Autosave runs after user inactivity.

Rules

- Never interrupt editing
- Save only changed files
- Save asynchronously
- Never block UI

---

## 9.6 Recovery

Unexpected shutdown

↓

Recovery detects unfinished session

↓

Restore latest autosave

↓

Verify integrity

↓

Open notebook

---

# =============================================================================

# Chapter 10

# Native .folio File Format

# =============================================================================

## 10.1 Overview

Internally a notebook is a folder.

For sharing or backup it becomes a .folio archive.

Example

```
My Notes/

metadata.json

sections/

pages/

assets/

search.db
```

Export

```
My Notes.folio
```

---

## 10.2 Why This Design

Advantages

- Easy backup
- Easy debugging
- Portable
- Human-readable metadata
- Fast loading
- Corruption recovery

---

## 10.3 File Types

metadata.json

Notebook information

---

page.json

Stores one page.

---

assets/

Images

Attachments

Future media

---

search.db

SQLite search index

Safe to rebuild.

---

## 10.4 Import

```
.folio

↓

Extract

↓

Validate

↓

Rebuild Search Index

↓

Open Notebook
```

---

## 10.5 Export

```
Notebook Folder

↓

Flush Pending Saves

↓

Compress

↓

Generate .folio

↓

Verify Archive

↓

Finish
```

---

## 

# =============================================================================

# Chapter 11

# Search Architecture

# =============================================================================

## 11.1 Overview

Folio provides fast, local search across notebooks without requiring an internet
connection.

Search is powered by SQLite Full-Text Search (FTS).

The search database is treated as a cache. If it becomes corrupted or deleted,
it is automatically rebuilt from notebook files.

---

## 11.2 Search Goals

- Instant search results
- Low memory usage
- Incremental indexing
- Offline operation
- Support future filters

---

## 11.3 Indexed Content

The following content is indexed:

- Notebook name
- Section names
- Page titles
- Rich text
- Sticky notes
- Tags
- Object metadata

The following content is not indexed in Version 2:

- Handwritten ink
- Images
- PDFs
- Audio
- Video

---

## 11.4 Search Flow

```
Notebook Saved
        │
        ▼
Detect Modified Files
        │
        ▼
Update Search Index
        │
        ▼
SQLite FTS
        │
        ▼
Ready for Search
```

---

## 11.5 Search Query Flow

```
User Types

↓

Debounce (200 ms)

↓

SQLite FTS Query

↓

Rank Results

↓

Highlight Matches

↓

Display Results
```

---

## 11.6 Future Improvements

Future versions may include:

- OCR search
- Handwriting recognition
- Semantic search
- AI-powered search
- Cross-notebook search ranking

---

# =============================================================================

# Chapter 12

# Rendering Architecture

# =============================================================================

## 12.1 Overview

The rendering engine is responsible for displaying notebook pages.

React renders the application interface.

Canvas renders notebook content.

This separation improves performance and allows smooth zooming and panning.

---

## 12.2 Rendering Pipeline

```
Notebook

↓

Page

↓

Page Objects

↓

Renderer

↓

Canvas

↓

Display
```

---

## 12.3 Render Cycle

```
User Action

↓

Update Object

↓

Mark Dirty Region

↓

Render Queue

↓

Canvas Draw

↓

Frame Complete
```

---

## 12.4 Dirty Rendering

The renderer should avoid redrawing the entire page whenever possible.

Instead:

- Detect changed objects
- Calculate affected region
- Clear affected region
- Redraw affected objects

Benefits:

- Higher FPS
- Lower CPU usage
- Better battery life

---

## 12.5 Object Rendering Order

Objects are rendered from bottom to top.

Example

```
Background

↓

Grid

↓

Images

↓

Shapes

↓

Ink

↓

Text

↓

Selection

↓

Guides

↓

Temporary Preview
```

---

## 12.6 Zoom

Zoom affects rendering only.

Notebook data is never modified.

Supported range:

- Minimum: 25%
- Default: 100%
- Maximum: 800%

---

## 12.7 Pan

Panning moves the viewport.

The page itself never moves.

---

## 12.8 Rendering Rules

- Rendering must be deterministic.
- Objects render in a fixed order.
- Rendering must not modify object data.
- Rendering should avoid unnecessary allocations.
- Rendering should support high-DPI displays.

---

# =============================================================================

# Chapter 13

# Undo / Redo Architecture

# =============================================================================

## 13.1 Overview

Undo and Redo are implemented using the Command Pattern.

Every user action is stored as a command.

Commands know how to:

- Execute
- Undo
- Redo

---

## 13.2 Command Flow

```
User Action

↓

Create Command

↓

Execute

↓

Push to Undo Stack
```

---

## 13.3 Undo

```
Undo

↓

Pop Undo Stack

↓

Reverse Action

↓

Push Redo Stack
```

---

## 13.4 Redo

```
Redo

↓

Pop Redo Stack

↓

Execute Again

↓

Push Undo Stack
```

---

## 13.5 Command Examples

- Draw Stroke
- Delete Stroke
- Insert Text
- Move Object
- Resize Object
- Rotate Object
- Change Color
- Add Image
- Delete Page
- Rename Section

---

## 13.6 Rules

Commands should:

- Be reversible
- Be independent
- Contain enough data to undo
- Never depend on UI state

---

## 13.7 History Limits

Version 2 stores history only for the current editing session.

History is cleared when the notebook is closed.

Persistent history may be added in a future release.

---

# =============================================================================

# Chapter 14

# Autosave & Recovery

# =============================================================================

## 14.1 Autosave

Autosave protects users from accidental data loss.

It runs automatically in the background.

No manual action is required.

---

## 14.2 Autosave Trigger

Autosave occurs when:

- User stops typing
- User stops drawing
- Page changes
- Application loses focus
- Notebook closes

---

## 14.3 Autosave Pipeline

```
Edit

↓

Mark Dirty

↓

Wait for Idle

↓

Write Modified Files

↓

Update Metadata

↓

Clear Dirty Flag
```

---

## 14.4 Recovery

If the application closes unexpectedly:

```
Launch

↓

Detect Recovery Data

↓

Validate Files

↓

Restore Notebook

↓

Continue Editing
```

---

## 14.5 Recovery Rules

- Never overwrite valid data.
- Restore only complete files.
- Remove temporary recovery files after successful recovery.

---

# =============================================================================

# Chapter 15

# Security Architecture

# =============================================================================

## 15.1 Goals

Security in Folio focuses on protecting the user's local data.

The application does not collect notebook content.

---

## 15.2 Renderer Security

The renderer process:

- Cannot access the file system directly.
- Cannot access Node.js APIs.
- Cannot execute arbitrary system commands.

---

## 15.3 Main Process Responsibilities

The main process handles:

- File access
- Native dialogs
- Window management
- Operating system integration

---

## 15.4 IPC Rules

Communication between renderer and main process must occur through validated IPC.

Rules:

- Validate all incoming data.
- Reject unknown messages.
- Return structured responses.
- Never expose unrestricted APIs.

---

## 15.5 Privacy

Version 2 stores notebook data locally.

No analytics are collected.

No notebook content is uploaded.

Internet access is not required for normal use.

---

## 15.6 Future Security Enhancements

Possible future additions:

- Notebook encryption
- Password-protected notebooks
- Digital signatures
- Secure cloud synchronization

---

## 

# =============================================================================

# Chapter 16

# Performance Architecture

# =============================================================================

## 16.1 Overview

Performance is one of the primary design goals of Folio.

Users should experience smooth writing, drawing, zooming, and navigation even
when working with large notebooks.

Performance optimizations should never compromise data integrity or code
maintainability.

---

## 16.2 Performance Goals

Target performance for Version 2:

| Operation | Target |
| --- | --- |
| Application Launch | < 3 seconds |
| Open Notebook | < 2 seconds |
| Page Switch | < 100 ms |
| Zoom | Smooth |
| Pan | Smooth |
| Object Selection | Instant |
| Autosave | Non-blocking |
| Search | < 200 ms |

---

## 16.3 Optimization Principles

- Avoid unnecessary rendering.
- Avoid unnecessary file writes.
- Load only required data.
- Cache frequently used resources.
- Perform heavy work asynchronously.

---

## 16.4 Lazy Loading

Notebook resources should be loaded only when needed.

Examples:

- Page thumbnails
- Images
- Large attachments

Benefits

- Faster startup
- Lower memory usage

---

## 16.5 Memory Management

Resources no longer in use should be released.

Examples

- Image cache
- Thumbnail cache
- Temporary buffers

Avoid retaining references to deleted objects.

---

## 16.6 Background Tasks

The following operations should run without blocking the UI:

- Autosave
- Search indexing
- Thumbnail generation
- Export
- Import

---

## 16.7 Future Optimizations

Potential improvements:

- GPU rendering
- Virtual page rendering
- Incremental painting
- Object pooling

---

# =============================================================================

# Chapter 17

# Testing Strategy

# =============================================================================

## 17.1 Objective

Testing ensures application reliability and prevents regressions.

Version 2 focuses on practical automated testing rather than exhaustive
coverage.

---

## 17.2 Test Levels

### Unit Tests

Verify individual functions.

Examples

- Utility functions
- Serialization
- Object validation

---

### Integration Tests

Verify communication between modules.

Examples

- Save and Load
- Search Index
- Autosave

---

### UI Tests

Verify user interactions.

Examples

- Create Notebook
- Draw Stroke
- Insert Image
- Undo
- Redo

---

### Manual Testing

Before every release verify:

- Create notebook
- Save notebook
- Reopen notebook
- Draw
- Type
- Export
- Import

---

## 17.3 Critical Features

The following features should always be tested before release:

- Save
- Load
- Autosave
- Recovery
- Search
- Export
- Import
- Undo
- Redo

---

## 17.4 Error Logging

Errors should be logged for debugging.

Logs should include:

- Timestamp
- Module
- Error Message
- Stack Trace (Development Mode)

Sensitive notebook content should not be written to logs.

---

# =============================================================================

# Chapter 18

# Build Pipeline

# =============================================================================

## 18.1 Development Build

Development workflow:

```
Developer

↓

Install Dependencies

↓

Run Development Server

↓

Electron Launch

↓

Hot Reload

↓

Development
```

---

## 18.2 Production Build

Production workflow:

```
Source Code

↓

Type Check

↓

Lint

↓

Build React

↓

Package Electron

↓

Generate Installer
```

---

## 18.3 Build Requirements

Every production build must:

- Pass TypeScript compilation
- Pass linting
- Include required assets
- Include application icons
- Package Electron correctly

---

## 18.4 Build Artifacts

Generated files include:

- Executable
- Installer
- Source Maps (Development)
- Release Notes

---

# =============================================================================

# Chapter 19

# Release Pipeline

# =============================================================================

## 19.1 Release Steps

```
Complete Development

↓

Testing

↓

Bug Fixes

↓

Build

↓

Final Verification

↓

Release
```

---

## 19.2 Pre-Release Checklist

Before release verify:

- No TypeScript errors
- No lint errors
- No console errors
- Save/Load works
- Autosave works
- Search works
- Export works
- Import works
- Installer works

---

## 19.3 Versioning

Suggested version format:

Major.Minor.Patch

Examples

- 2.0.0
- 2.1.0
- 2.1.1

---

# =============================================================================

# Chapter 20

# Development Roadmap

# =============================================================================

## Phase 1

Foundation

- Electron setup
- React setup
- Project structure
- Build configuration

---

## Phase 2

Application Shell

- Window
- Sidebar
- Toolbar
- Navigation
- Settings

---

## Phase 3

Domain Model

- Notebook
- Section
- Page
- Page Objects

---

## Phase 4

Persistence

- Folder structure
- Save
- Load
- Autosave
- Recovery

---

## Phase 5

Canvas Engine

- Viewport
- Rendering
- Zoom
- Pan
- Selection

---

## Phase 6

Writing Experience

- Rich Text
- Pen
- Highlighter
- Eraser

---

## Phase 7

Objects

- Images
- Shapes
- Tables
- Sticky Notes

---

## Phase 8

Search

- SQLite Index
- Search UI
- Filters

---

## Phase 9

Import / Export

- PDF
- Image
- Native .folio

---

## Phase 10

Polish

- Animations
- Accessibility
- Performance
- Bug Fixes

---

# =============================================================================

# Final Architecture Decisions

# =============================================================================

## Decision 1

Notebook files are the source of truth.

SQLite is only a cache and search index.

---

## Decision 2

Notebook pages are fixed-size pages.

Infinite canvas is not supported in Version 2.

---

## Decision 3

Canvas renders notebook content.

React renders application UI.

---

## Decision 4

Composition is preferred over inheritance.

Objects own only the capabilities they require.

---

## Decision 5

Persistence is implemented before advanced editor features.

Preventing data loss has higher priority than adding functionality.

---

## Decision 6

The application is Windows-first but designed so future macOS and Linux support
is possible with minimal architectural changes.

---

# Architecture Summary

This document defines the technical architecture for Folio Version 2.

The architecture is built around five fundamental principles:

- Offline-first operation
- Notebook files as the source of truth
- Clear separation between UI, domain, rendering, and persistence
- Modular object-based design
- Reliable, maintainable, and extensible implementation

Future features such as cloud synchronization, collaboration, handwriting
recognition, plugins, and AI assistance are intentionally excluded from Version
2 but can be added without major architectural changes.

---

# End of Volume 4
