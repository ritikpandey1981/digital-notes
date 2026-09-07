# FOLIO

# Volume 6 – Complete UI Blueprint

### Version 2.0

---

# 1. Design Principles

Every screen follows five rules:

1. The notebook is always the primary visual element.
2. Keep controls hidden until they are needed.
3. Use generous whitespace.
4. Motion should explain changes, not decorate them.
5. Every screen should feel calm and uncluttered.

---

# 2. Application Flow

The user journey is intentionally simple:

```
Launch App
      ↓
Notebook Library
      ↓
Select Notebook
      ↓
Notebook Opening Animation
      ↓
Editor
      ↓
Edit → Autosave
      ↓
Close
```

The user should never have to navigate through multiple menus to begin writing.

---

# 3. Launch Screen

Purpose:

- Start quickly.
- Restore the previous session if applicable.

Layout:

```
--------------------------------------------------
                 FOLIO Logo

              "Write beautifully."

        Opening Recent Notebook...
--------------------------------------------------
```

Behavior:

- Fade in over 300 ms.
- If a recent notebook exists, open it automatically (configurable).
- Otherwise, show the Notebook Library.

---

# 4. Notebook Library

This is the application's home.

Layout:

```
----------------------------------------------------
 Sidebar        Notebook Grid
----------------------------------------------------

 Favorites      [Notebook] [Notebook] [Notebook]

 Recent         [Notebook] [Notebook] [Notebook]

 Tags           [Notebook] [Notebook] [Notebook]
----------------------------------------------------
```

Notebook Card contains:

- Cover
- Title
- Subtitle
- Last modified
- Page count
- Favorite indicator

Hover:

- Slight lift (4 px)
- Shadow increases
- Cover brightens slightly

Double-click:

- Open notebook

Right-click:

- Rename
- Duplicate
- Export
- Delete
- Properties

---

# 5. Create Notebook Dialog

Fields:

- Title
- Description
- Cover Style
- Cover Color
- Notebook Size
- Paper Type
- Default Theme

Live Preview:

The dialog always shows a notebook preview that updates as settings change.

Buttons:

- Cancel
- Create Notebook

---

# 6. Notebook Opening

Animation sequence:

1. Notebook card enlarges.
2. Moves to screen center.
3. Cover opens.
4. First page slides into view.
5. Toolbar fades in.
6. Cursor is placed on the page.

Duration:

400–600 ms.

---

# 7. Main Editor

Layout:

```
+-------------------------------------------------------------+
| Floating Toolbar                                             |
+-------------------------------------------------------------+

 Sidebar     Notebook Page              Right Panel

             -------------------------
             |                       |
             |      Writing Area     |
             |                       |
             -------------------------

+-------------------------------------------------------------+
| Status Bar                                                   |
+-------------------------------------------------------------+
```

---

# 8. Sidebar

Tabs:

- Library
- Pages
- Bookmarks
- Search
- Tags
- Trash

Collapsed width:

72 px

Expanded width:

260 px

Animation:

250 ms.

---

# 9. Floating Toolbar

The toolbar is centered above the notebook.

Sections:

- File
- Edit
- Insert
- Draw
- Format
- View

Context-aware behavior:

- Selecting text reveals text formatting tools.
- Selecting an image reveals image controls.
- Selecting a table reveals table controls.
- Selecting ink reveals pen settings.

---

# 10. Notebook Page

Appearance:

- Rounded corners
- Soft shadow
- Ivory paper
- Optional texture
- Visible page stack beneath

Page sizes:

- A4
- Letter
- A5
- B5
- Custom

Optional:

- Margins
- Header
- Footer
- Page numbers

---

# 11. Writing Experience

Typing:

- Cursor appears immediately.
- No visible lag.
- Rich text formatting available.

Handwriting:

- Ink follows the pointer smoothly.
- Pressure sensitivity (if supported).
- Palm rejection (where available).
- Eraser feels immediate.

---

# 12. Page Navigation

Page panel shows thumbnails.

Each thumbnail displays:

- Miniature page preview
- Page title
- Bookmark indicator

Drag-and-drop:

- Reorder pages.

Double-click:

- Rename page.

---

# 13. Search Panel

Search field at the top.

Results grouped by:

- Notebook
- Page
- Text
- Bookmark

Selecting a result:

- Opens the page.
- Highlights the matching content.

---

# 14. Right Properties Panel

Changes depending on selection.

No selection:

- Page settings

Text selected:

- Font
- Size
- Alignment
- Color
- Spacing

Image selected:

- Size
- Rotation
- Crop
- Opacity

Shape selected:

- Fill
- Border
- Shadow

Ink selected:

- Pen type
- Thickness
- Color
- Opacity

---

# 15. Dialog Style

All dialogs:

- Rounded corners (20 px)
- Soft shadow
- Frosted background
- Keyboard accessible
- Animated entry/exit

Avoid full-screen dialogs unless necessary.

---

# 16. Context Menus

Appearance:

- Rounded
- Glass effect
- Compact
- Icons aligned left
- Keyboard shortcuts aligned right

Typical actions:

- Copy
- Paste
- Duplicate
- Delete
- Lock
- Group

---

# 17. Status Bar

Displays:

- Current page
- Total pages
- Zoom level
- Active tool
- Autosave status
- Selection info

Never display unnecessary information.

---

# 18. Notifications

Location:

Bottom-right corner.

Style:

- Rounded
- Small
- Fade in/out

Examples:

- Notebook saved.
- PDF exported.
- Recovery successful.

No intrusive pop-ups.

---

# 19. Empty States

Library:

"No notebooks yet."

Search:

"No results found."

Bookmarks:

"No bookmarks."

Each state includes:

- Friendly illustration
- Short explanation
- Primary action button

---

# 20. Settings Screen

Categories:

- General
- Appearance
- Notebook Defaults
- Drawing
- Keyboard
- Export
- Updates
- About

Each category is displayed in a two-column layout with navigation on the left and settings on the right.

---

# 21. Export Dialog

Preview panel on the left.

Options on the right:

- Format
- Page range
- Quality
- Paper size
- Margins

Bottom:

- Cancel
- Export

---

# 22. Keyboard Navigation

Every interactive element should be reachable with the keyboard.

Tab order should move logically through:

- Toolbar
- Sidebar
- Editor
- Properties panel
- Status bar

---

# 23. Accessibility

- Adjustable UI scaling
- High-contrast mode
- Configurable shortcuts
- Visible focus indicators
- Descriptive labels for controls

---

# 24. Animation Guidelines

Use animation consistently:

- Buttons: 150 ms
- Menus: 200 ms
- Dialogs: 250 ms
- Sidebar: 250 ms
- Notebook open: 500 ms
- Page turn: 350 ms

Animations should never block user input longer than necessary.

---

# 25. UI Consistency Rules

- One accent color across the application.
- Consistent spacing (prefer an 8 px spacing system).
- Consistent icon style.
- Consistent corner radius.
- Consistent typography.
- Consistent shadows.

No screen should feel visually unrelated to the others.

---

# 26. Screen Inventory

The complete application should eventually include:

1. Splash Screen
2. Welcome Screen (optional)
3. Notebook Library
4. Create Notebook
5. Notebook Properties
6. Main Editor
7. Search Panel
8. Bookmarks Panel
9. Pages Panel
10. Tags Panel
11. Export Dialog
12. Settings
13. About
14. Recovery Dialog
15. Import Dialog
16. Delete Confirmation
17. Shortcut Editor
18. Theme Editor

---

# 27. UI Review Checklist

Before accepting any new screen:

- Does it keep the notebook as the focus?
- Is there unnecessary visual clutter?
- Are controls discoverable?
- Does it match the design system?
- Is keyboard navigation possible?
- Does it work in light and dark mode?
- Is the animation smooth?
- Does it feel like part of the same application?
