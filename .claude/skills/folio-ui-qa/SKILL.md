---
name: folio-ui-qa
description: Validate ONE implemented Folio UI component before freeze — automated gates, Electron visual inspection against the approved reference, canvas/input safety, console, and performance. Ends in PASS, PASS WITH DEFERRED VISUAL NOTES, or NO-GO. Use after implementation, before asking the user to approve a freeze.
---

# Folio UI QA

**One responsibility: decide whether one implemented component is ready to freeze.**

This skill validates. It does not implement, and it does not redesign. If a defect
needs fixing, report it — fixing is a scoped correction task under `folio-ui`.

The approved reference/specification for the component is the standard being measured
against. Without one, say so and stop: there is nothing to validate against.

---

## 1. Automated Gates

Run what the task calls for, and report each result honestly:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git diff --check
```

- Focused unit tests for the component first, then the complete suite.
- Relevant Electron E2E specs, then the full E2E run when the task requires it.
- Electron pointer specs need foreground window focus — re-run a failing pointer spec
  on its own before calling it a regression.
- Never run a repository-wide formatter to fix one file.

**Green gates are necessary and never sufficient.**

## 2. Visual Electron QA

Inspect the running application. At minimum:

- standard working window
- minimum supported window
- the feature closed **and** open, if it has both
- hover
- active
- selected
- disabled, if applicable
- keyboard focus, if applicable
- relevant artwork / color / content states (empty, one item, many items, long names)
- coexistence with nearby panels — open the neighbours and check placement
- canvas usability with the feature open

## 3. Reference Comparison

Compare specifically, not impressionistically:

placement · dimensions · proportions · density · spacing · hierarchy · typography ·
icon size · control shape · selection state · hover state · transient behavior ·
dismissal · animation/motion · pointer behavior

> **Do not evaluate only "overall vibe."** Name the property, the reference value, the
> observed value, and the delta.

## 4. Canvas Safety

Where relevant, test explicitly:

- **first stroke after panel dismissal** — the classic regression
- first selection click after dismissal
- first shape drag after dismissal
- wheel over the canvas and over the new surface
- `Escape` behavior
- pointer capture during a drag that leaves the surface
- pointer behavior on the page, on the workspace, and outside both

## 5. Console

No unexpected errors or warnings related to the feature. Report anything new, including
React warnings and framework noise introduced by the change.

## 6. Performance

Check for:

- unnecessary whole-workspace React rerenders
- massive DOM collections
- expensive JS animation loops
- unnecessary canvas/WebGL usage for simple UI
- pointer-move state causing avoidable React churn
- memory or listener leaks (open/close the surface repeatedly)

## 7. User Approval

**Final visual freeze requires the user's manual approval.** Claude's screenshot review
is useful evidence but is **not** sufficient. Present findings and let the user decide.

## 8. Output

Report the gate results, the visual comparison table, canvas-safety results, console,
and performance observations. Then output **exactly one** classification:

- **PASS** — matches the approved design, gates green, no outstanding defects.
- **PASS WITH DEFERRED VISUAL NOTES** — functionally and architecturally sound, gates
  green, with named cosmetic deltas the user has been asked to accept or defer. List
  every deferred note.
- **NO-GO** — a gate failed, a canvas/input regression exists, or the implementation
  does not match the approved design.

Do not stretch to reach a PASS. A NO-GO reported early is cheaper than a freeze
reverted late.
