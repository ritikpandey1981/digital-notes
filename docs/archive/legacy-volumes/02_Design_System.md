# FOLIO

# Volume 2 – UI/UX Design System

### Version 2.0

---

# 1. Design Philosophy

The UI should disappear while the notebook remains the focus.

Every interface element exists to support writing, never to distract from it.

The notebook is always the hero.

The software stays in the background.

---

# 2. Design Language

Folio should look:

- Modern
- Minimal
- Premium
- Soft
- Clean
- Elegant
- Calm

Avoid:

- Office ribbon UI
- Heavy gradients
- Neon colors
- Skeuomorphic leather textures
- Thick borders
- Dense interfaces

---

# 3. Overall Layout

The application consists of four regions.

```
---------------------------------------------------------
 Top Toolbar
---------------------------------------------------------

Sidebar |            Notebook Workspace            | Right Panel

Sidebar |                                         | Properties
Folders |           Open Notebook                 | Layers
Recent  |                                         | Outline
Search  |                                         | Bookmarks

---------------------------------------------------------
 Status Bar
---------------------------------------------------------
```

The notebook occupies around **70–75%** of the screen width. Sidebars should remain visually lightweight.

---

# 4. Color Palette

### Light Mode

Background: Soft warm gray (#F5F5F3)

Notebook paper: Ivory (#FFFDF8)

Sidebar: White (#FFFFFF)

Toolbar: Frosted glass

Primary accent: Indigo (#4F46E5)

Success: Emerald

Warning: Amber

Danger: Red

Text: Near black (#1E1E1E)

Secondary text: Gray

---

### Dark Mode

Workspace: #181818

Notebook paper: #252525

Writing ink: White

Toolbar: Frosted dark glass

Accent remains Indigo.

Avoid pure black backgrounds.

---

# 5. Typography

Primary font

Inter

Alternative

SF Pro

Headers

600–700 weight

Body

400–500 weight

Notebook titles

20–28px

Body

16–18px

Never use decorative fonts.

---

# 6. Border Radius

Cards

18 px

Dialogs

20 px

Buttons

12 px

Notebook Covers

22 px

Context menus

14 px

Keep corners soft.

---

# 7. Shadows

Use subtle elevation.

Cards

Small blur

Dialogs

Medium blur

Notebook

Slight floating shadow

Never use harsh shadows.

---

# 8. Glassmorphism

Only use glass effects for:

Top toolbar

Floating toolbars

Context menus

Dialogs

Never use glass on notebook pages.

---

# 9. Navigation

Primary navigation:

Library

↓

Notebook

↓

Page

↓

Content

Users should never get lost.

Always show current notebook.

---

# 10. Sidebar

Contains:

Library

Folders

Favorites

Recent

Pinned notebooks

Tags

Trash

Settings

Sidebar width:

Collapsed

72 px

Expanded

260 px

Smooth animation.

---

# 11. Notebook Library

Current version:

Simple list.

New version:

Grid of notebook cards.

Each notebook card contains:

Cover

Title

Last edited

Page count

Paper type

Hover animation

Small shadow

Hover lift

Context menu

Cards should resemble premium notebooks.

---

# 12. Notebook Covers

Support:

Leather

Fabric

Minimal solid colors

Gradient

Paper

Wood

Custom image

Notebook spine visible.

Rounded corners.

Subtle thickness.

---

# 13. Workspace

Workspace background:

Soft gray.

Notebook centered.

Lots of breathing room.

Notebook slightly elevated.

---

# 14. Notebook

Notebook should have:

Rounded corners

Soft shadow

Visible thickness

Page stack

Paper texture

Curved edges

Optional binding

Never look like a plain white rectangle.

---

# 15. Pages

Paper types:

Ruled

Grid

Dot

Blank

Engineering

Music

Cornell

Planner

Journal

Page numbers

Optional.

Date

Optional.

Margins

Optional.

---

# 16. Toolbar

Current version

Feels crowded.

New version

Floating toolbar.

Rounded.

Glass.

Organized.

Sections:

Writing

Formatting

Insert

Drawing

Review

Export

---

# 17. Tool Icons

Simple line icons.

Consistent size.

No colorful icons.

Hover animation.

---

# 18. Right Panel

Contains:

Bookmarks

Outline

Properties

Page settings

Layers

Can collapse.

Resizable.

---

# 19. Bottom Status Bar

Small.

Shows:

Zoom

Page number

Pen tool

Autosave

Word count

Cursor position

Never dominate screen.

---

# 20. Notebook Opening Animation

Current:

Instant.

New:

Click notebook.

↓

Notebook enlarges.

↓

Moves to center.

↓

Cover opens.

↓

Page appears.

↓

Toolbar fades in.

Duration:

400–600 ms.

---

# 21. Page Turning

Page curl.

Soft shadow.

Visible page thickness.

Sound optional.

Drag page corner.

Click arrows.

Swipe.

No abrupt switching.

---

# 22. Writing Experience

Highest priority.

Ink should appear instantly.

Curves should be smooth.

Pressure supported.

Palm rejection.

No visible lag.

Writing should feel natural even with a mouse.

---

# 23. Images

Drag and drop.

Resize.

Rotate.

Crop.

Rounded corners.

Shadow.

Wrap text.

---

# 24. Tables

Simple.

Resizable.

Modern.

Rounded selection.

Keyboard navigation.

---

# 25. Shapes

Rectangle

Circle

Triangle

Arrow

Line

Polygon

Star

Editable.

Resizable.

Snap to guides.

---

# 26. Search

Instant.

Search:

Notebook

Pages

Text

Bookmarks

Tags

Highlight results.

---

# 27. Dialogs

Rounded.

Minimal.

Blur background.

Keyboard friendly.

Animated.

---

# 28. Context Menus

Compact.

Rounded.

Glass.

Icons.

Shortcuts.

---

# 29. Notifications

Bottom right.

Small.

Fade in.

Fade out.

No blocking popups.

---

# 30. Keyboard Shortcuts

Ctrl + N

New notebook

Ctrl + Shift + N

New page

Ctrl + S

Save

Ctrl + Z

Undo

Ctrl + Y

Redo

Ctrl + F

Search

Ctrl + P

Export PDF

Ctrl + D

Duplicate page

Ctrl + /

Shortcuts help

---

# 31. Animations

Every animation:

200–400 ms

Ease-in-out

Smooth

GPU accelerated

Examples:

Sidebar

Notebook open

Notebook close

Hover

Dialogs

Context menus

Buttons

Page turn

Zoom

Search

---

# 32. Empty States

Instead of empty white screens:

Illustration

Helpful message

Quick action button

Example:

"No notebooks yet."

Create Notebook

---

# 33. Accessibility

Keyboard navigation

High contrast

Scalable UI

Large cursor support

Screen reader labels where practical

---

# 34. Responsive Behavior

Window resize.

Notebook remains centered.

Panels collapse gracefully.

Never overlap notebook.

---

# 35. Premium Details

These small touches make the application feel polished:

- Hovering over a notebook slightly lifts it with a soft shadow.
- Bookmarks protrude slightly from page edges like real tabs.
- Notebook pages have a faint paper texture and subtle depth.
- Autosave shows a gentle "Saved" checkmark rather than intrusive notifications.
- Buttons animate smoothly instead of changing abruptly.
- Zooming feels continuous rather than stepping between levels.
- Search highlights fade in and out elegantly.
- Dialogs scale and fade into view instead of simply appearing.

---

# 36. Design Rules (Must Follow)

Every new screen should satisfy these rules:

- Keep the notebook as the visual focus.
- Show only the controls needed for the current task.
- Maintain consistent spacing, typography, and corner radii.
- Prefer neutral colors with a single accent color.
- Use animation to clarify interactions, not to decorate.
- Avoid visual clutter and unnecessary controls.
