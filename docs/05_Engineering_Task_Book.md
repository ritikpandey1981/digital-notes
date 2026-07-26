# FOLIO

# Volume 5

# Engineering Task Book & Implementation Roadmap

**Version:** 2.0

**Status:** Active Development

---

# Purpose

This document defines the implementation order for Folio.

Unlike the Technical Architecture document, which explains *how the system is designed*, this document explains *how the system should be built*.

Every feature is divided into small implementation tasks.

Each task has:

- Objective
- Dependencies
- Deliverables
- Completion Checklist

Following this order minimizes rework and ensures that every new feature is built on a stable foundation.

---

# Development Principles

The following principles apply throughout the project.

## 1. Build Stable Foundations First

Never build editor features before save/load works.

Never build advanced UI before the application shell exists.

Never optimize code that has not been verified to work correctly.

---

## 2. One Feature at a Time

Every feature should be completed before moving to the next.

Avoid leaving partially implemented functionality.

---

## 3. Keep Every Commit Functional

At any point during development:

- Project should compile.
- Application should launch.
- Existing features should continue working.

Broken commits should never become the main development branch.

---

## 4. Small Independent Components

Each component should have one responsibility.

Example

Good

```
Toolbar

Canvas

Sidebar

SearchPanel

StatusBar
```

Poor

```
EditorManager

(Contains 5000+ lines handling everything)
```

---

## 5. Keep Business Logic Separate

Business logic belongs in services and stores.

UI components should only display data and handle user interaction.

---

## 6. Avoid Premature Optimization

First make it correct.

Then make it clean.

Finally make it fast.

---

# Recommended Development Workflow

For every new feature:

```
Plan

↓

Create Data Model

↓

Implement Logic

↓

Connect UI

↓

Test

↓

Refactor

↓

Merge
```

Never start with UI first.

---

# Project Milestones

| Phase | Name |
| --- | --- |
| 1 | Foundation |
| 2 | Application Shell |
| 3 | Domain Model |
| 4 | Persistence |
| 5 | History System |
| 6 | Canvas Engine |
| 7 | Drawing Tools |
| 8 | Notebook Objects |
| 9 | Search |
| 10 | Import & Export |
| 11 | Settings |
| 12 | Polish |

---

# =============================================================================

# Phase 1

# Foundation

# =============================================================================

## Goal

Create a clean project that launches successfully.

No notebook functionality is required.

At the end of this phase, the application should open a window and support hot reload.

---

## Task 1.1

### Create Repository

Objective

Create the Git repository.

Deliverables

- Repository initialized
- README
- .gitignore
- License

Checklist

- [ ]  Git initialized
- [ ]  Initial commit completed

---

## Task 1.2

### Create Electron Application

Objective

Create the Electron desktop application.

Deliverables

- Electron installed
- Window opens
- Application icon configured

Checklist

- [ ]  Electron starts
- [ ]  Window opens
- [ ]  Window closes correctly

---

## Task 1.3

### Configure React

Objective

Integrate React with Electron.

Deliverables

- React
- TypeScript
- Vite

Checklist

- [ ]  React renders
- [ ]  Hot reload works

---

## Task 1.4

### Configure Tailwind

Objective

Install Tailwind CSS.

Deliverables

- Tailwind configured
- Global styles working

Checklist

- [ ]  Utility classes work
- [ ]  Fonts load correctly

---

## Task 1.5

### Configure shadcn/ui

Objective

Install UI component library.

Deliverables

- Button
- Dialog
- Input
- Scroll Area

Checklist

- [ ]  Components render correctly

---

## Task 1.6

### Configure Project Structure

Create folders.

```
src/

components/

features/

hooks/

services/

stores/

types/

utils/

assets/
```

Checklist

- [ ]  Folder structure complete

---

## Task 1.7

### Configure Code Quality

Install

- ESLint
- Prettier

Checklist

- [ ]  Formatting works
- [ ]  Linting works

---

## Task 1.8

### Configure Build

Verify

Development Build

Production Build

Checklist

- [ ]  Dev build
- [ ]  Production build

---

## Phase 1 Completion Criteria

Application should:

✔ Launch

✔ Hot Reload

✔ Build Successfully

✔ TypeScript Working

✔ Tailwind Working

✔ Electron Working

---

# =============================================================================

# Phase 2

# Application Shell

# =============================================================================

## Goal

Build the application framework before implementing notebook functionality.

The UI should look complete, even though many actions are placeholders.

---

## Task 2.1

### Create Main Window

Layout

```
+------------------------------------------------+
| Menu Bar                                       |
+------------------------------------------------+
| Toolbar                                        |
+------------------------------------------------+
| Sidebar |             Canvas Area              |
|         |                                      |
|         |                                      |
|         |                                      |
+------------------------------------------------+
| Status Bar                                    |
+------------------------------------------------+
```

Checklist

- [ ]  Layout complete

---

## Task 2.2

### Navigation

Create

- Notebook List
- Recent Files
- Search Button
- Settings Button

Checklist

- [ ]  Navigation functional

---

## Task 2.3

### Toolbar

Create placeholders for

- Select
- Pen
- Highlighter
- Eraser
- Text
- Image
- Shape
- Table
- Sticky Note
- Zoom

Buttons do not require functionality yet.

Checklist

- [ ]  Toolbar complete

---

## Task 2.4

### Sidebar

Create collapsible sidebar.

Future panels

- Pages
- Sections
- Search
- Assets

Checklist

- [ ]  Sidebar opens
- [ ]  Sidebar closes

---

## Task 2.5

### Status Bar

Display

- Zoom Level
- Page Number
- Save Status

Placeholder values are acceptable.

Checklist

- [ ]  Status bar visible

---

## Task 2.6

### Theme Support

Implement

- Light Theme
- Dark Theme

Checklist

- [ ]  Theme switches correctly

---

## Task 2.7

### Dialog System

Create reusable dialogs.

Examples

- Open
- Save
- Delete
- Confirm
- Rename

Checklist

- [ ]  Dialog component reusable

---

## Task 2.8

### Notification System

Create toast notifications.

Examples

- Saved
- Export Complete
- Import Failed
- Error

Checklist

- [ ]  Toast notifications working

---

## Phase 2 Completion Criteria

Application should now have:

✔ Main Window

✔ Sidebar

✔ Toolbar

✔ Status Bar

✔ Dialog System

✔ Theme Support

✔ Notifications

Although no notebook functionality exists yet, the application should already feel like a real desktop application.

---

# =============================================================================

# Phase 3

# Domain Model

# =============================================================================

## Goal

Build the core notebook data model.

This phase does **not** involve rendering or UI interactions. The objective is to create a robust data structure that accurately represents notebook content.

Once this phase is complete, the application should be able to create notebook objects entirely in memory.

---

## Task 3.1

### Create Core Types

Objective

Create the fundamental domain types.

Deliverables

- Notebook
- Section
- Page
- PageObject
- Asset

Checklist

- [ ]  Types created
- [ ]  Types documented
- [ ]  No circular dependencies

---

## Task 3.2

### Notebook Model

Implement

```
Notebook

id

name

createdAt

updatedAt

cover

theme

sections

settings
```

Functions

- Create notebook
- Rename notebook
- Update metadata

Checklist

- [ ]  Notebook creation works
- [ ]  Metadata updates correctly

---

## Task 3.3

### Section Model

Implement

```
Section

id

title

pages

color

icon
```

Functions

- Create section
- Delete section
- Rename section
- Reorder sections

Checklist

- [ ]  CRUD operations complete

---

## Task 3.4

### Page Model

Implement

```
Page

id

width

height

background

objects

createdAt

updatedAt
```

Functions

- Create page
- Delete page
- Duplicate page
- Reorder pages

Checklist

- [ ]  Page management complete

---

## Task 3.5

### Page Object Base

Create the base interface for all notebook objects.

Properties

```
id

type

position

rotation

locked

visible
```

All future objects should inherit these common properties through composition.

Checklist

- [ ]  Base interface complete

---

## Task 3.6

### Capability Interfaces

Create reusable capabilities.

Examples

- Selectable
- Renderable
- Serializable
- Movable
- Resizable
- Editable
- Searchable
- Lockable

Checklist

- [ ]  Interfaces completed
- [ ]  Documentation written

---

## Task 3.7

### Validation

Validate object integrity.

Examples

- Unique IDs
- Valid page references
- Valid object types
- Required properties present

Checklist

- [ ]  Validation functions complete

---

## Phase 3 Completion Criteria

The application should now be able to:

✔ Create notebooks

✔ Create sections

✔ Create pages

✔ Create notebook objects

✔ Validate notebook data

No UI functionality is required at this stage.

---

# =============================================================================

# Phase 4

# Persistence

# =============================================================================

## Goal

Implement reliable notebook storage.

This is the most important phase of the application.

After completion, notebooks should survive application restarts.

---

## Task 4.1

### Create Folder Structure

Implement notebook directory structure.

```
Notebook/

metadata.json

sections/

pages/

assets/

thumbnails/

search.db
```

Checklist

- [ ]  Folder structure created automatically

---

## Task 4.2

### JSON Serialization

Implement serialization for:

- Notebook
- Section
- Page
- Objects
- Settings

Checklist

- [ ]  Objects serialize correctly
- [ ]  Objects deserialize correctly

---

## Task 4.3

### Save Notebook

Implement notebook saving.

Pipeline

```
Notebook

↓

Serialize

↓

Write JSON

↓

Success
```

Checklist

- [ ]  Save succeeds
- [ ]  Existing notebook updates correctly

---

## Task 4.4

### Load Notebook

Pipeline

```
Folder

↓

Read JSON

↓

Deserialize

↓

Notebook
```

Checklist

- [ ]  Notebook loads correctly
- [ ]  Missing files handled safely

---

## Task 4.5

### Autosave

Implement automatic saving.

Requirements

- Save after inactivity
- Background operation
- Save only modified files

Checklist

- [ ]  Autosave works
- [ ]  UI remains responsive

---

## Task 4.6

### Recovery

Implement crash recovery.

Flow

```
Crash

↓

Recovery Files

↓

Restore

↓

Continue Editing
```

Checklist

- [ ]  Recovery verified

---

## Task 4.7

### Dirty State Tracking

Track modified content.

Notebook should know whether changes are unsaved.

Status examples

```
Saved

Saving...

Unsaved Changes
```

Checklist

- [ ]  Dirty state accurate

---

## Task 4.8

### File Versioning

Store notebook format version.

Example

```json
{
  "version": "2.0"
}
```

Purpose

Future compatibility.

Checklist

- [ ]  Version stored
- [ ]  Version validated

---

## Phase 4 Completion Criteria

Application should now support:

✔ Save

✔ Load

✔ Autosave

✔ Recovery

✔ Dirty Tracking

✔ Version Validation

Notebook data should now be reliable.

---

# =============================================================================

# Phase 5

# History System (Undo / Redo)

# =============================================================================

## Goal

Implement command-based undo and redo.

Every modification to notebook data should pass through the history system.

---

## Task 5.1

### Command Interface

Create a standard command interface.

Each command should support:

- Execute
- Undo
- Redo

Checklist

- [ ]  Interface completed

---

## Task 5.2

### History Manager

Responsibilities

- Execute commands
- Store undo stack
- Store redo stack
- Clear redo after new command

Checklist

- [ ]  Manager implemented

---

## Task 5.3

### Basic Commands

Implement

- Create Page
- Delete Page
- Rename Section
- Move Object

Checklist

- [ ]  Commands undo correctly

---

## Task 5.4

### Drawing Commands

Implement

- Add Stroke
- Delete Stroke
- Move Stroke

These commands will be used later when drawing tools are added.

Checklist

- [ ]  Drawing commands implemented

---

## Task 5.5

### Text Commands

Implement

- Insert Text
- Delete Text
- Edit Text

Checklist

- [ ]  Text history functional

---

## Task 5.6

### History Limits

Implement configurable limits.

Example

Maximum

```
100 Commands
```

When the limit is reached:

- Oldest commands are discarded.
- Memory usage remains controlled.

Checklist

- [ ]  Limit enforced

---

## Task 5.7

### Keyboard Shortcuts

Implement

Ctrl + Z

Ctrl + Shift + Z

Ctrl + Y

Checklist

- [ ]  All shortcuts work

---

## Phase 5 Completion Criteria

Application should now support:

✔ Unlimited editing workflow

✔ Undo

✔ Redo

✔ Keyboard shortcuts

✔ Stable command history

At this point, the application's foundation is complete. All future editor features will build on this infrastructure.

---

# =============================================================================

# Phase 6

# Canvas Engine

# =============================================================================

## Goal

Build the notebook editor's rendering engine.

At the end of this phase, users should be able to navigate pages smoothly even before any drawing tools are implemented.

The focus is on the editor infrastructure, not object creation.

---

## Task 6.1

### Create Canvas Component

Objective

Create the main canvas responsible for displaying notebook pages.

Responsibilities

- Render page background
- Handle viewport
- Receive user input
- Forward events to tools

Checklist

- [ ]  Canvas renders
- [ ]  Resizes correctly
- [ ]  High-DPI supported

---

## Task 6.2

### Viewport

Implement viewport management.

Responsibilities

- Camera position
- Zoom level
- Visible area

Checklist

- [ ]  Viewport initialized
- [ ]  Viewport updates correctly

---

## Task 6.3

### Zoom

Implement smooth zooming.

Requirements

- Mouse Wheel + Ctrl
- Toolbar controls
- Keyboard shortcuts

Limits

Minimum

```
25%
```

Maximum

```
800%
```

Checklist

- [ ]  Zoom works smoothly
- [ ]  Center point preserved

---

## Task 6.4

### Pan

Implement canvas panning.

Methods

- Middle Mouse
- Space + Drag

Checklist

- [ ]  Smooth panning
- [ ]  No viewport glitches

---

## Task 6.5

### Grid & Page Background

Render

- Paper background
- Optional grid
- Optional ruled lines

Background should scale correctly during zoom.

Checklist

- [ ]  Background renders correctly

---

## Task 6.6

### Selection Framework

Create the foundation for object selection.

Requirements

- Single selection
- Multi-selection (future-ready)
- Selection outline

Checklist

- [ ]  Selection manager created

---

## Task 6.7

### Render Queue

Implement rendering pipeline.

Flow

```
Object Changed

↓

Mark Dirty

↓

Queue Render

↓

Redraw
```

Checklist

- [ ]  Render queue implemented

---

## Phase 6 Completion Criteria

Editor should support

✔ Zoom

✔ Pan

✔ Viewport

✔ Page rendering

✔ Selection framework

No drawing tools yet.

---

# =============================================================================

# Phase 7

# Drawing Tools

# =============================================================================

## Goal

Implement handwriting and freehand drawing.

This phase delivers the notebook writing experience.

---

## Task 7.1

### Pen Tool

Implement

- Mouse input
- Stylus input (if available)
- Continuous stroke creation

Properties

- Width
- Color
- Opacity

Checklist

- [ ]  Pen works

---

## Task 7.2

### Highlighter

Implement translucent strokes.

Requirements

- Adjustable width
- Adjustable opacity

Checklist

- [ ]  Highlighter complete

---

## Task 7.3

### Eraser

Support

- Stroke eraser
- Partial eraser (future)

Version 2

Entire stroke removal is sufficient.

Checklist

- [ ]  Eraser functional

---

## Task 7.4

### Stroke Rendering

Render strokes using smooth curves.

Requirements

- No visible gaps
- Smooth appearance
- Consistent thickness

Checklist

- [ ]  Smooth rendering

---

## Task 7.5

### Stroke Selection

Allow users to

- Select stroke
- Delete stroke
- Move stroke

Checklist

- [ ]  Stroke selection works

---

## Task 7.6

### Stroke Serialization

Save and restore strokes.

Checklist

- [ ]  Saved correctly
- [ ]  Loaded correctly

---

## Task 7.7

### Pressure Support (Optional)

If stylus supports pressure

Adjust

- Width
- Opacity

Mouse input should continue working normally.

Checklist

- [ ]  Graceful fallback

---

## Phase 7 Completion Criteria

Users can now

✔ Write

✔ Highlight

✔ Erase

✔ Save handwriting

✔ Reload handwriting

---

# =============================================================================

# Phase 8

# Notebook Objects

# =============================================================================

## Goal

Implement all remaining notebook objects.

Each object should integrate with:

- Rendering
- Selection
- Undo
- Save/Load

---

## Task 8.1

### Rich Text

Features

- Text box
- Font
- Size
- Alignment
- Color

Checklist

- [ ]  Rich text working

---

## Task 8.2

### Images

Support

- Insert image
- Resize
- Rotate
- Move

Supported formats

- PNG
- JPG
- JPEG
- WEBP

Checklist

- [ ]  Images functional

---

## Task 8.3

### Shapes

Implement

- Rectangle
- Circle
- Line
- Arrow

Features

- Fill
- Border
- Resize

Checklist

- [ ]  Shapes complete

---

## Task 8.4

### Tables

Version 2

Support

- Insert table
- Add rows
- Add columns
- Edit cells

Advanced spreadsheet features are out of scope.

Checklist

- [ ]  Tables usable

---

## Task 8.5

### Sticky Notes

Implement

- Color
- Resize
- Rich text
- Move

Checklist

- [ ]  Sticky notes complete

---

## Task 8.6

### Layer Order

Support

- Bring Forward
- Send Backward
- Bring To Front
- Send To Back

Checklist

- [ ]  Layer ordering functional

---

## Task 8.7

### Object Locking

Allow user to

- Lock
- Unlock

Locked objects

- Cannot move
- Cannot resize
- Cannot edit

Checklist

- [ ]  Locking works

---

## Task 8.8

### Duplicate Objects

Support

- Duplicate
- Copy
- Paste

Keyboard Shortcuts

```
Ctrl+C

Ctrl+V

Ctrl+D
```

Checklist

- [ ]  Duplication works

---

## Task 8.9

### Delete Objects

Support deletion using

- Delete key
- Context menu
- Toolbar

Checklist

- [ ]  Delete works

---

## Phase 8 Completion Criteria

Notebook editor should now support

✔ Rich Text

✔ Images

✔ Shapes

✔ Tables

✔ Sticky Notes

✔ Copy/Paste

✔ Layer Ordering

✔ Locking

At this point, Folio becomes a fully functional notebook editor.

---

# =============================================================================

# Phase 9

# Search

# =============================================================================

## Goal

Implement fast offline search for notebook content.

Search should allow users to quickly locate information without scanning every
page manually.

Version 2 focuses on text-based search only.

---

## Task 9.1

### Create Search Database

Objective

Create a local SQLite Full-Text Search (FTS) database.

Responsibilities

- Store searchable content
- Update automatically
- Rebuild if missing

Checklist

- [ ]  Search database created
- [ ]  Database initializes automatically

---

## Task 9.2

### Index Notebook Content

Index

- Notebook names
- Section names
- Page titles
- Rich text
- Sticky notes
- Tags

Do Not Index

- Images
- Handwriting
- PDFs

Checklist

- [ ]  Index created successfully

---

## Task 9.3

### Update Search Index

Whenever notebook data changes:

```
Edit

↓

Save

↓

Update Search Index
```

Requirements

- Incremental updates
- Background execution
- Non-blocking

Checklist

- [ ]  Index updates automatically

---

## Task 9.4

### Search Panel

Create dedicated search panel.

Features

- Search box
- Result count
- Result list

Checklist

- [ ]  Search panel functional

---

## Task 9.5

### Search Results

Each result should display

- Notebook
- Section
- Page
- Matching text preview

Selecting a result should navigate directly to the page.

Checklist

- [ ]  Navigation works

---

## Task 9.6

### Search Filters

Version 2

Support filtering by

- Notebook
- Section

Future

- Tags
- Object Type
- Date

Checklist

- [ ]  Filters implemented

---

## Phase 9 Completion Criteria

Application should support

✔ Instant search

✔ Search navigation

✔ Search indexing

✔ Offline search

---

# =============================================================================

# Phase 10

# Import & Export

# =============================================================================

## Goal

Allow users to move notebook data into and out of Folio.

---

## Task 10.1

### Native Export (.folio)

Pipeline

```
Notebook

↓

Flush Pending Saves

↓

Compress Folder

↓

Create .folio
```

Checklist

- [ ]  Archive generated
- [ ]  Archive validated

---

## Task 10.2

### Native Import (.folio)

Pipeline

```
.folio

↓

Extract

↓

Validate

↓

Open Notebook
```

Checklist

- [ ]  Import successful
- [ ]  Invalid files handled safely

---

## Task 10.3

### PDF Export

Allow exporting pages as PDF.

Requirements

- Single page
- Entire notebook
- Preserve layout

Checklist

- [ ]  PDF export complete

---

## Task 10.4

### Image Export

Supported formats

- PNG
- JPG

User options

- Current page
- Selected pages

Checklist

- [ ]  Image export works

---

## Task 10.5

### File Validation

Validate

- Version
- Required files
- Corrupted archives

Display meaningful error messages.

Checklist

- [ ]  Validation implemented

---

## Phase 10 Completion Criteria

Users can now

✔ Export notebooks

✔ Import notebooks

✔ Export PDFs

✔ Export images

---

# =============================================================================

# Phase 11

# Settings

# =============================================================================

## Goal

Provide application customization without affecting notebook data.

---

## Task 11.1

### General Settings

Implement

- Startup behavior
- Language (future-ready)
- Autosave interval

Checklist

- [ ]  General settings saved

---

## Task 11.2

### Appearance

Options

- Light Theme
- Dark Theme
- System Theme

Checklist

- [ ]  Appearance settings work

---

## Task 11.3

### Editor Preferences

Settings

- Default zoom
- Grid visibility
- Page background
- Pen defaults
- Highlighter defaults

Checklist

- [ ]  Preferences persist

---

## Task 11.4

### Keyboard Shortcuts

Display available shortcuts.

Future versions may allow customization.

Checklist

- [ ]  Shortcut list available

---

## Task 11.5

### About Dialog

Display

- Application version
- Build number
- License
- Credits

Checklist

- [ ]  About dialog complete

---

## Phase 11 Completion Criteria

Application settings should be fully functional and persist between sessions.

---

# =============================================================================

# Phase 12

# Polish & Performance

# =============================================================================

## Goal

Improve usability, stability, and overall quality before release.

No major features should be added during this phase.

---

## Task 12.1

### Performance Optimization

Review

- Rendering
- Memory usage
- Startup time
- Search speed
- Autosave

Checklist

- [ ]  Performance acceptable

---

## Task 12.2

### UI Polish

Review

- Alignment
- Icons
- Padding
- Typography
- Animations

Checklist

- [ ]  UI consistent

---

## Task 12.3

### Accessibility

Verify

- Keyboard navigation
- Focus indicators
- Readable contrast
- Scalable UI

Checklist

- [ ]  Accessibility reviewed

---

## Task 12.4

### Error Handling

Review

- File errors
- Save failures
- Import failures
- Recovery failures

Users should receive clear error messages.

Checklist

- [ ]  Error handling complete

---

## Task 12.5

### Final Bug Fixes

Resolve

- UI bugs
- Rendering issues
- Save/load issues
- Crash reports

Checklist

- [ ]  Critical bugs fixed

---

# =============================================================================

# Final Quality Assurance Checklist

# =============================================================================

## Core Features

- [ ]  Create notebook
- [ ]  Open notebook
- [ ]  Save notebook
- [ ]  Autosave
- [ ]  Recovery
- [ ]  Search
- [ ]  Undo
- [ ]  Redo

---

## Editor

- [ ]  Zoom
- [ ]  Pan
- [ ]  Selection
- [ ]  Pen
- [ ]  Highlighter
- [ ]  Eraser

---

## Objects

- [ ]  Rich Text
- [ ]  Images
- [ ]  Shapes
- [ ]  Tables
- [ ]  Sticky Notes

---

## File Operations

- [ ]  Export .folio
- [ ]  Import .folio
- [ ]  Export PDF
- [ ]  Export PNG
- [ ]  Export JPG

---

## UI

- [ ]  Theme switching
- [ ]  Sidebar
- [ ]  Toolbar
- [ ]  Status bar
- [ ]  Notifications
- [ ]  Dialogs

---

# =============================================================================

# Definition of Done

# =============================================================================

A feature is considered complete only when all of the following conditions are met:

### Functionality

- Works as intended.
- Meets the requirements defined in the Feature Specification (Volume 3).

---

### Reliability

- No known critical bugs.
- Handles invalid input gracefully.
- Does not crash the application.

---

### Integration

- Supports Undo / Redo.
- Supports Save / Load.
- Updates the search index (if applicable).
- Follows the domain model.

---

### User Experience

- Consistent with the design system.
- Responsive.
- Accessible using keyboard where appropriate.

---

### Code Quality

- TypeScript passes without errors.
- ESLint passes without errors.
- No unnecessary code duplication.
- Public APIs documented where needed.

---

# =============================================================================

# Version 2 Release Checklist

# =============================================================================

Before publishing Version 2, verify the following:

## Application

- [ ]  Builds successfully in production mode.
- [ ]  Installer launches correctly.
- [ ]  Application icon and metadata are correct.

---

## Notebook Features

- [ ]  Create, edit, save, and reopen notebooks.
- [ ]  Autosave and recovery are verified.
- [ ]  Undo/Redo behaves correctly.

---

## Editor Features

- [ ]  Pen, highlighter, and eraser function correctly.
- [ ]  Rich text, images, shapes, tables, and sticky notes work as expected.
- [ ]  Zoom and pan remain smooth.

---

## Import / Export

- [ ]  Import `.folio` archives successfully.
- [ ]  Export `.folio` archives successfully.
- [ ]  PDF and image exports preserve page layout.

---

## Final Verification

- [ ]  No critical or high-priority bugs remain.
- [ ]  User documentation is updated.
- [ ]  Version number is incremented.
- [ ]  Release notes are prepared.
- [ ]  Git repository is tagged for release.

---

# Engineering Notes

This roadmap is intentionally sequential. Each phase builds on the previous one to reduce rework and simplify debugging.

The recommended implementation order is:

```
Foundation
        ↓
Application Shell
        ↓
Domain Model
        ↓
Persistence
        ↓
History System
        ↓
Canvas Engine
        ↓
Drawing Tools
        ↓
Notebook Objects
        ↓
Search
        ↓
Import & Export
        ↓
Settings
        ↓
Polish & Testing
        ↓
Release
```

Following this sequence ensures that every user-facing feature is built on a stable, testable foundation.

---

#