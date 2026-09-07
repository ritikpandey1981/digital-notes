# FOLIO

# Volume 3 – Feature Specifications

### Version 2.0

---

# 1. Notebook Management

## Goal

Users should feel like they are managing a collection of real notebooks.

---

### Create Notebook

User clicks **New Notebook**

↓

Dialog opens

↓

User selects:

- Notebook Name
- Cover Style
- Cover Color
- Cover Material
- Notebook Size
- Paper Type
- Default Font
- Page Number Option

↓

Create

↓

Notebook appears inside library with opening animation.

---

### Notebook Metadata

Every notebook stores:

```
Notebook ID

Title

Description

Cover

Paper Type

Page Count

Created Date

Last Modified

Pinned

Favorite

Tags

Notebook Size

Default Pen

Default Theme
```

---

### User Actions

Rename

Duplicate

Delete

Move

Archive

Export

Share (future)

Favorite

Pin

Lock

---

# 2. Notebook Covers

Each notebook can have:

Leather

Fabric

Minimal

Paper

Wood

Gradient

Custom Image

---

Notebook cover stores:

```
Material

Color

Texture

Corner Radius

Title

Subtitle

Icon
```

---

# 3. Pages

Every notebook contains pages.

Each page stores:

```
Page ID

Page Number

Title

Created

Modified

Template

Background

Objects

Bookmarks
```

---

### Page Operations

Add

Duplicate

Move

Delete

Rotate

Bookmark

Lock

Export

---

# 4. Page Templates

Supported templates:

Blank

Ruled

Grid

Dot

Engineering

Cornell

Planner

Meeting Notes

Music

Storyboard

Journal

Math

Users can create custom templates.

---

# 5. Rich Text

Supported:

Headings

Paragraphs

Lists

Checkboxes

Tables

Quotes

Code

Links

Highlights

Bold

Italic

Underline

Strikethrough

Superscript

Subscript

Text should wrap naturally around embedded objects where appropriate.

---

# 6. Handwriting Engine

This is the heart of Folio.

Requirements:

Vector based.

Pressure sensitive.

Bezier smoothing.

Palm rejection.

Unlimited undo.

Infinite zoom.

Low latency.

Support:

Mouse

Touch

Stylus

Surface Pen

Graphics tablets

---

Pens:

Ball Pen

Gel Pen

Fountain Pen

Marker

Highlighter

Brush

Calligraphy

Pencil

Eraser

Lasso

Laser Pointer

---

Each pen stores:

```
Color

Thickness

Opacity

Pressure Curve

Texture

Smoothing

Shortcut
```

---

# 7. Shapes

Supported:

Rectangle

Rounded Rectangle

Circle

Ellipse

Triangle

Diamond

Arrow

Line

Polygon

Star

Cloud

Freeform

Each shape:

Resizable

Rotatable

Fill

Border

Shadow

Opacity

Grouping

---

# 8. Images

Insert methods:

Drag

Clipboard

File Picker

Paste

Resize

Crop

Rotate

Flip

Opacity

Shadow

Rounded corners

Captions

Wrap text

---

Supported formats:

PNG

JPG

JPEG

WEBP

GIF (first frame)

SVG

---

# 9. Tables

Insert table.

Rows

Columns

Merge

Split

Resize

Header Row

Alternating Row Colors

Cell Color

Text Alignment

Formula support (future)

---

# 10. Sticky Notes

Types:

Yellow

Blue

Pink

Green

Purple

Users can:

Move

Resize

Collapse

Pin

Change Color

---

# 11. Bookmarks

Bookmarks appear as tabs extending slightly beyond the page edge.

Bookmark contains:

```
Title

Color

Page

Icon

Created
```

Click bookmark

↓

Navigate instantly.

---

# 12. Search

Search:

Notebook titles

Page titles

Typed text

Bookmarks

Tags

Search is instant.

Highlight results.

Arrow navigation.

---

# 13. Tags

Notebook tags.

Page tags.

Custom colors.

Hierarchy (future).

---

# 14. Drawing Objects

Every object:

Selectable

Movable

Resizable

Duplicated

Grouped

Locked

Layered

Deleted

Copied

---

# 15. Layers

Layer system:

Background

Writing

Images

Shapes

Annotations

Users can:

Hide

Lock

Rename

Reorder

Duplicate

Merge

---

# 16. Zoom

Zoom:

25%

50%

75%

100%

125%

150%

200%

400%

800%

Continuous pinch zoom on touch devices.

Double-click returns to 100%.

---

# 17. Export

Formats:

PDF

PNG

JPEG

Markdown

HTML

Native Folio

Settings:

Page Range

Resolution

Paper Size

Margins

Background

Compression

---

# 18. Autosave

Autosave every few seconds and after significant edits.

Visual indicator:

"Saved" with a subtle checkmark.

No modal dialogs.

---

# 19. Undo / Redo

Unlimited history (bounded by available memory or configured limits).

Works across:

Writing

Typing

Images

Tables

Shapes

Page operations

Notebook settings

---

# 20. Keyboard Shortcuts

Navigation

Editing

Drawing

Page management

Notebook management

Export

Search

Every shortcut customizable.

---

# 21. Themes

Light

Dark

Sepia

Night Paper

Custom accent color

Paper color

Ink color

Grid color

---

# 22. Settings

General

Appearance

Notebook Defaults

Drawing

Keyboard

Storage

Export

Updates

About

---

# 23. File Format

Native extension:

```
.folio
```

Internally:

```
Notebook Metadata

Pages

Assets

History

Templates

Thumbnails

Settings
```

The format should support future expansion without breaking older notebooks.

---

# 24. Performance Targets

Startup:

<2 seconds

Page switching:

Near-instant

Notebook opening:

<500 ms

Drawing latency:

As low as practical for supported hardware

Large notebook support:

Thousands of pages

Hundreds of images

---

# 25. Error Recovery

Recover unsaved notebooks after crashes.

Keep recent versions.

Warn before destructive actions.

Gracefully handle missing assets.

---

# 26. Future Features (Not in V2)

Cloud sync

OCR

AI assistant

Collaboration

Voice transcription

Handwriting recognition

Mobile companion apps

---

# 27. Acceptance Checklist

Version 2 is considered complete when:

- Notebook management is intuitive.
- Writing feels smooth and responsive.
- Page navigation is fast.
- Images, tables, and shapes work reliably.
- Search is quick and accurate.
- Export preserves notebook appearance.
- The UI remains responsive with large notebooks.
- Autosave and recovery protect user work.

---

## One architectural improvement I'd add

I would make **everything on a page an "object."** Instead of treating text, drawings, images, and tables as separate systems, represent them all through a common object model. For example:

```
Notebook
 ├── Pages
 │    ├── Objects
 │    │      ├── Text Block
 │    │      ├── Ink Stroke
 │    │      ├── Image
 │    │      ├── Table
 │    │      ├── Shape
 │    │      ├── Sticky Note
 │    │      └── Audio Note (future)
```
