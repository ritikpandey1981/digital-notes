# Folio — GENESIS EIR Cohort-3 Pitch Deck

Deck-generation tooling for the GENESIS Entrepreneur-in-Residence (EIR) Cohort-3
application to MeitY Startup Hub.

**This directory is isolated from the Folio application.** Nothing here is
imported by `apps/*` or `packages/*`, and its dependencies live in a local
`node_modules` created by `npm`, outside the pnpm workspace (which only covers
`apps/*` and `packages/*`). No production code was modified to produce this deck.

---

## Regenerate the deck

```bash
cd docs/genesis-eir-pitch && npm install && node build-deck.mjs
```

Output: `Folio_GENESIS_EIR_Cohort3_Pitch_Deck.pptx` (14 slides — 11 main + 3
backup, 16:9, fully editable text/shapes/table, speaker notes embedded).

To use a different typeface:

```bash
node build-deck.mjs --font="Inter"
```

---

## Recapture the product screenshots

The screenshots in `assets/` are **real captures of the Folio application**, not
mockups. They are produced by launching the built Electron app under Playwright
and drawing a two-point-perspective box through the normal pointer input path.

```bash
pnpm build && node docs/genesis-eir-pitch/capture-screenshots.mjs
```

Run from the repository root. `pnpm build` is required first — the capture script
launches `apps/desktop/dist-electron/main.js`.

The captured box is deliberately drawn with a shallow top-right edge that rises
away from its vanishing point instead of converging toward it. That is a real
beginner perspective error, and it is the geometry the deck's illustrative
feedback annotations point at — so the annotation is describing something that is
genuinely in the drawing.

---

## Files

| File | Purpose |
| --- | --- |
| `build-deck.mjs` | Deck generator (PptxGenJS) |
| `capture-screenshots.mjs` | Launches the real app and captures product screenshots |
| `speaker-notes.md` | 45–75 s of notes per slide, plus likely Q&A |
| `assets/folio-workspace-sketch.png` | Workspace with the perspective study (slides 1, 4) |
| `assets/folio-tool-options.png` | Pencil tool options over the same artwork |
| `assets/folio-canvas-closeup.png` | Tight crop of the drawing |
| `assets/folio-workspace-dark.png` | Dark appearance of the same workspace |
| `assets/folio-icon.png` | Copy of `assets/app-icon.png` from the repository root |

`folio-tool-options.png`, `folio-canvas-closeup.png` and `folio-workspace-dark.png`
are captured but not currently placed in the deck. They are kept as alternates —
`folio-tool-options.png` in particular is useful if a reviewer asks to see the
real tool controls.

---

## Design system

Palette and typography are derived from the shipped Folio UI, not invented:

| Deck role | Value | Folio source |
| --- | --- | --- |
| Background | `#FAFAF8` | `--folio-topbar` |
| Dark ground (cover, closing band) | `#24211F` | `--folio-workspace` (dark theme) |
| Ink | `#20201E` | `--folio-ink` |
| Muted | `#777772` | `--folio-muted` |
| Accent | `#6F64B5` | `--folio-accent` (light theme) |
| Accent on dark | `#8B7BD6` | `--folio-accent` (dark theme) |
| Paper / surface | `#FFFDF8` / `#FFFFFF` | `--folio-paper` / `--folio-surface` |

All from `apps/desktop/src/styles.css`. The visual motif — a faint horizon rule,
one convergence guide and a registration cross — echoes a perspective study,
which is the product's own subject matter.

**Typography: Segoe UI, not Inter.** Folio's own font is Inter
(`@fontsource-variable/inter`), but Inter is not installed on this machine and is
not guaranteed on a reviewer's. A missing font silently reflows an entire PPTX,
so the deck uses Segoe UI, which is universal on Windows and substitutes
predictably elsewhere. Pass `--font="Inter"` when presenting from a machine that
has it.

---

## Claims discipline

Everything factual in the deck is either sourced or repository-evidenced. The
deck deliberately does **not** claim paying customers, user counts, revenue,
partnerships, patents, a proprietary foundation model, or a working AI tutor.

- Current stage is stated as **TRL 3**; the target is **TRL 4**.
- Grant language is always **"up to ₹10 lakh"**, never awarded.
- Every AI tutoring visual is labelled **illustrative**, and slides 4, 5, 9 and 10
  each carry an explicit statement of what is *not* built.
- Market figures are labelled **"relevant market indicators"**, never Folio's TAM,
  and are footnoted to Precision Reports (June 2026) and IBEF (May 2026).

### Layout constraints worth knowing before editing

- **Slide titles must stay on one line at 26 pt.** Longer titles wrap into the
  content area. If you raise `T.title.fontSize`, re-render and check slides 6, 7,
  9 and 11 — those are the longest titles.
- PptxGenJS applies a default text inset. Narrow boxes (the `01`–`08` markers on
  slide 10, the budget labels on slide 11) pass `margin: 0` or they wrap one
  character per line.
- Screenshot heights are always derived from the PNG's intrinsic dimensions via
  `pngSize()`, so images can never be placed distorted.

---

## Validation performed

The generated PPTX was opened in PowerPoint and all 14 slides were exported to
PNG and inspected for text overflow, clipping, overlap, margin consistency,
distorted images and misaligned diagrams. To repeat that check:

```bash
powershell -File render-deck.ps1
```

That opens the PPTX via PowerPoint COM, exports each slide to `render/slide-NN.png`,
and requires PowerPoint to be installed. It is a QA aid, not part of the build.
