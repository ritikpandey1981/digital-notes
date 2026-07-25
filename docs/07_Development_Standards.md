# FOLIO

# Volume 7 – Development Standards & Codex Guide

### Version 2.0

---

# 1. Purpose

This document defines the engineering standards for Folio.

Its goals are:

- Maintain a clean architecture.
- Keep the codebase consistent.
- Reduce technical debt.
- Produce readable, maintainable code.
- Ensure every generated feature matches the product vision.

These rules take precedence over implementation convenience.

---

# 2. Engineering Philosophy

Every implementation should prioritize:

1. Correctness
2. Readability
3. Maintainability
4. Performance
5. Reusability

Avoid clever solutions that make the code harder to understand.

---

# 3. General Coding Rules

- Use TypeScript everywhere.
- Enable strict type checking.
- Avoid `any` unless there is a documented reason.
- Prefer immutable data where practical.
- Use descriptive names.
- Avoid duplicated logic.
- Remove dead code promptly.

---

# 4. Architecture Rules

The application must follow a layered architecture:

```
UI
↓

Feature Modules

↓

Services

↓

Storage

↓

Operating System
```

Each layer depends only on the layer below it.

UI components should not directly access the file system or database.

---

# 5. Folder Responsibilities

`components/`

- Reusable UI only.

`features/`

- Feature-specific logic.

`services/`

- File handling, export, rendering, autosave, search.

`stores/`

- Global state.

`hooks/`

- Reusable React hooks.

`types/`

- Shared interfaces and types.

`utils/`

- Pure helper functions.

---

# 6. Component Rules

Each component should:

- Have one responsibility.
- Be reusable.
- Receive data through props.
- Avoid hidden side effects.
- Keep rendering logic simple.

If a component exceeds roughly 300–400 lines, consider splitting it.

---

# 7. State Management Rules

Keep separate stores for:

- UI state
- Notebook state
- Editor state
- Settings
- History

Do not mix persisted notebook data with temporary UI state.

---

# 8. Object-Oriented Content Model

Every page element derives from a common object model.

```
PageObject

├── TextObject
├── StrokeObject
├── ImageObject
├── ShapeObject
├── TableObject
├── StickyNoteObject
```

Every object supports:

- Selection
- Move
- Delete
- Serialization
- Layering
- Locking

---

# 9. Performance Rules

Never block the UI thread unnecessarily.

Requirements:

- Lazy load large assets.
- Virtualize long lists.
- Debounce search.
- Batch state updates where appropriate.
- Cache thumbnails.
- Avoid unnecessary re-renders.

---

# 10. File Naming

Use clear names.

Examples:

```
NotebookCard.tsx

EditorToolbar.tsx

SearchPanel.tsx

NotebookStore.ts

ExportService.ts

PageRenderer.ts
```

Avoid vague names such as:

```
helper.ts

new.ts

temp.ts

component2.tsx
```

---

# 11. Naming Conventions

Components:

- PascalCase

Variables:

- camelCase

Interfaces:

- Prefix with `I` only if that convention is adopted consistently; otherwise use descriptive names like `NotebookMetadata`.

Constants:

- UPPER_SNAKE_CASE

Enums:

- PascalCase

Functions:

- Verb-based names

Examples:

```
createNotebook()

exportPDF()

loadNotebook()

saveNotebook()

deletePage()
```

---

# 12. Comment Policy

Comments should explain intent, not restate obvious code.

Good:

```
// Keep object IDs stable so undo/redo can reference them.
```

Avoid:

```
// Increment i.i++;
```

Document public APIs and non-obvious algorithms.

---

# 13. Error Handling

Never silently ignore errors.

Prefer:

- Meaningful error messages.
- Recovery where possible.
- User-friendly notifications.
- Structured logging.

---

# 14. Testing Rules

Every completed feature should be tested.

Minimum:

- Happy path.
- Invalid input.
- Undo/redo interaction.
- Save and reload.
- Keyboard shortcuts.
- Performance with realistic data.

---

# 15. UI Rules

Every new screen must:

- Follow Volume 2.
- Follow Volume 6.
- Support light and dark themes.
- Match spacing and typography standards.

No screen should introduce a different visual language.

---

# 16. Accessibility Rules

All interactive controls should:

- Be keyboard accessible.
- Show visible focus.
- Have accessible labels.
- Respect UI scaling.

---

# 17. Git Workflow

Recommended branch structure:

```
main

develop

feature/notebook-library

feature/editor

feature/search

feature/export
```

Commit frequently with descriptive messages.

Examples:

```
feat(editor): add page thumbnails

fix(export): preserve page margins

refactor(storage): simplify notebook loading
```

---

# 18. Pull Request Checklist

Before merging:

- Builds successfully.
- No TypeScript errors.
- No lint errors.
- Manual tests pass.
- Matches design specifications.
- No obvious performance regressions.

---

# 19. Definition of Done

A task is complete only if:

- Feature works as specified.
- Code follows architecture.
- UI matches the design.
- Tests pass.
- No new warnings or errors.
- Documentation is updated if needed.

---

# 20. Refactoring Rules

Refactor when:

- Code is duplicated.
- Responsibilities are unclear.
- Components become too large.
- Logic becomes difficult to test.

Do not refactor unrelated areas while implementing a feature unless necessary to complete the task.

---

# 21. Codex Prompt Template

Use a consistent prompt for every implementation task.

```
You are contributing to the Folio desktop application.

Before writing code:

1. Follow Volume 1 (Vision)
2. Follow Volume 2 (Design System)
3. Follow Volume 3 (Feature Specification)
4. Follow Volume 4 (Architecture)
5. Follow Volume 7 (Development Standards)

Task:
[Insert one task from Volume 5.]

Requirements:
- Modify only the files necessary.
- Preserve existing functionality.
- Explain architectural decisions if introducing a new pattern.
- Ensure the project builds without errors.
- Provide a summary of changed files and manual testing steps.
```

---

# 22. Coding Standards

Prefer:

- Small functions.
- Clear interfaces.
- Explicit types.
- Dependency injection where appropriate.
- Composition over inheritance.

Avoid:

- Global mutable state.
- Circular dependencies.
- Deep component nesting.
- Magic numbers.
- Hard-coded strings scattered throughout the code.

---

# 23. Future-Proofing

When adding a feature:

Ask:

- Will cloud sync work with this?
- Will AI integrate with this?
- Can this object be serialized?
- Can undo/redo support it?
- Can export support it?

If not, reconsider the design before implementation.

---

# 24. Anti-Patterns

Avoid:

- Monolithic components.
- Business logic inside JSX.
- Direct database access from UI.
- Repeated rendering code.
- Copy-pasted styles.
- Tight coupling between unrelated modules.

---

# 25. Engineering Principles

The codebase should always be:

- Predictable
- Modular
- Extensible
- Readable
- Performant
- Consistent
- Well-tested

Future contributors should be able to understand a module without reading the entire project.

---

# 26. Final Engineering Rule

Every implementation should answer **yes** to these questions:

- Does it match the product vision?
- Does it follow the design system?
- Does it fit the architecture?
- Is it maintainable?
- Is it testable?
- Will it scale with future features?
- Would another developer immediately understand it?

If the answer to any of these is "no," revise the implementation before considering it complete.