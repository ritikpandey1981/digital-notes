/**
 * Folio — GENESIS EIR Cohort-3 pitch deck generator.
 *
 * Deck tooling only. Nothing here is imported by the Folio application.
 *
 * Palette and typography are derived from the shipped Folio UI
 * (apps/desktop/src/styles.css) and docs/design/folio-design-system.md.
 *
 * Run: node docs/genesis-eir-pitch/build-deck.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, "assets");
const OUTPUT = path.join(here, "Folio_GENESIS_EIR_Cohort3_Pitch_Deck.pptx");

/**
 * Segoe UI rather than Folio's own Inter: Inter is not guaranteed to be
 * installed on a reviewer's machine, and a missing font silently reflows the
 * whole deck. Override with --font="Inter" when presenting from a machine that
 * has it.
 */
const fontArgument = process.argv.find((argument) => argument.startsWith("--font="));
const FONT = fontArgument ? fontArgument.slice("--font=".length) : "Segoe UI";

// ---------------------------------------------------------------------------
// Design tokens, derived from Folio's own light theme
// ---------------------------------------------------------------------------

const C = {
  bg: "FAFAF8", // --folio-topbar
  workspace: "F1F1EF", // --folio-workspace
  paper: "FFFDF8", // --folio-paper
  surface: "FFFFFF", // --folio-surface
  ink: "20201E", // --folio-ink
  muted: "777772", // --folio-muted
  faint: "9C9C96",
  border: "E0E0DC", // --folio-border over the deck background
  borderStrong: "C9C9C3",
  accent: "6F64B5", // --folio-accent (light theme)
  accentDeep: "574D95",
  accentLight: "8B7BD6", // --folio-accent (dark theme), for dark grounds
  accentSoft: "E7E5EF", // --folio-accent-soft over the deck background
  accentSofter: "F2F1F7",
  dark: "24211F", // --folio-workspace (dark theme)
  darkSurface: "332F2B", // --folio-surface (dark theme)
  darkBorder: "45403A",
  inkInverse: "F0EDE7", // --folio-ink (dark theme)
  mutedInverse: "A9A29A", // --folio-muted (dark theme)
};

const M = { left: 0.85, right: 0.85, top: 0.62 };
const CONTENT_W = 13.333 - M.left - M.right; // 11.633

const T = {
  eyebrow: { fontFace: FONT, fontSize: 10.5, bold: true, charSpacing: 2.2, color: C.accent },
  // 26pt keeps every slide title on a single line at this content width.
  // Longer titles wrap into the content area, so do not raise this without
  // re-rendering and checking slides 6, 7, 9 and 11.
  title: { fontFace: FONT, fontSize: 26, bold: true, color: C.ink },
  lead: { fontFace: FONT, fontSize: 13.5, color: C.muted },
  body: { fontFace: FONT, fontSize: 11.5, color: C.ink },
  small: { fontFace: FONT, fontSize: 10, color: C.muted },
  micro: { fontFace: FONT, fontSize: 8.5, color: C.faint },
  label: { fontFace: FONT, fontSize: 9, bold: true, charSpacing: 1.4, color: C.muted },
  stat: { fontFace: FONT, fontSize: 34, bold: true, color: C.ink },
};

/** Reads intrinsic PNG dimensions so no screenshot is ever placed distorted. */
function pngSize(file) {
  const buffer = fs.readFileSync(file);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "FOLIO_16x9", width: 13.333, height: 7.5 });
pptx.layout = "FOLIO_16x9";
pptx.author = "Ritik Pandey";
pptx.company = "Folio";
pptx.title = "Folio — GENESIS EIR Cohort-3";
pptx.subject = "AI that teaches you to sketch — instead of sketching for you.";

let slideNumber = 0;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Faint construction-line motif: the sketching craft, used sparingly. */
function constructionMotif(slide, { dark = false } = {}) {
  const hair = dark ? C.darkBorder : "E6E6E1";
  // A single horizon and one convergence guide, echoing a perspective study.
  slide.addShape(pptx.ShapeType.line, {
    x: 0,
    y: 1.42,
    w: 13.333,
    h: 0,
    line: { color: hair, width: 0.5 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 11.3,
    y: 1.42,
    w: 2.033,
    h: 0.34,
    line: { color: hair, width: 0.5 },
  });
  // Registration cross, bottom-left: an annotation mark, not decoration.
  slide.addShape(pptx.ShapeType.line, {
    x: 0.5,
    y: 7.1,
    w: 0.16,
    h: 0,
    line: { color: hair, width: 0.75 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.58,
    y: 7.02,
    w: 0,
    h: 0.16,
    line: { color: hair, width: 0.75 },
  });
}

function newSlide({ dark = false, motif = true, notes = "" } = {}) {
  const slide = pptx.addSlide();
  slide.background = { color: dark ? C.dark : C.bg };
  if (motif) constructionMotif(slide, { dark });
  if (notes) slide.addNotes(notes);
  slideNumber += 1;
  return slide;
}

/** Standard eyebrow + title block, plus the running footer. */
function header(slide, eyebrow, title, { dark = false, titleW = CONTENT_W } = {}) {
  slide.addText(eyebrow.toUpperCase(), {
    ...T.eyebrow,
    color: dark ? C.accentLight : C.accent,
    x: M.left,
    y: 0.5,
    w: titleW,
    h: 0.24,
  });
  slide.addText(title, {
    ...T.title,
    color: dark ? C.inkInverse : C.ink,
    x: M.left,
    y: 0.8,
    w: titleW,
    h: 0.5,
    valign: "top",
  });
  footer(slide, { dark });
}

function footer(slide, { dark = false } = {}) {
  slide.addText("Folio", {
    ...T.micro,
    color: dark ? C.mutedInverse : C.faint,
    bold: true,
    x: M.left,
    y: 7.02,
    w: 2,
    h: 0.24,
  });
  slide.addText(String(slideNumber).padStart(2, "0"), {
    ...T.micro,
    color: dark ? C.mutedInverse : C.faint,
    x: 13.333 - M.right - 1,
    y: 7.02,
    w: 1,
    h: 0.24,
    align: "right",
  });
}

/** A restrained surface: subtle border plus fill, never a heavy web card. */
function card(slide, { x, y, w, h, fill = C.surface, line = C.border, radius = 0.08, dash }) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    fill: { color: fill },
    line: { color: line, width: 1, dashType: dash },
    rectRadius: radius,
  });
}

/** An accent rule that marks a block without shouting. */
function accentRule(slide, { x, y, w = 0.42, color = C.accent }) {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h: 0.045,
    fill: { color },
    line: { color, width: 0 },
  });
}

function arrow(slide, { x, y, w, h = 0, color = C.borderStrong, width = 1.25 }) {
  slide.addShape(pptx.ShapeType.line, {
    x,
    y,
    w,
    h,
    line: { color, width, endArrowType: "triangle" },
  });
}

/** Small accent dot used instead of a glyph bullet, so no font can break it. */
function dot(slide, { x, y, size = 0.1, color = C.accent }) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x,
    y,
    w: size,
    h: size,
    fill: { color },
    line: { color, width: 0 },
  });
}

function chip(slide, { x, y, w, h = 0.26, text, fill = C.accentSoft, color = C.accentDeep }) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    fill: { color: fill },
    line: { color: fill, width: 0 },
    rectRadius: 0.06,
  });
  slide.addText(text, {
    fontFace: FONT,
    fontSize: 8,
    bold: true,
    charSpacing: 1.1,
    color,
    x,
    y,
    w,
    h,
    align: "center",
    valign: "middle",
  });
}

// ---------------------------------------------------------------------------
// SLIDE 1 — Cover / vision
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    dark: true,
    motif: false,
    notes: `Learning to draw is fundamentally a feedback-driven process. You draw something, someone identifies what went wrong, you correct it, and you repeat.

But when people learn online today, that feedback loop largely disappears.

Folio is our attempt to bring that loop back using AI. Instead of generating drawings for the learner, Folio observes how the learner draws and teaches them how to improve.

What you see on the right is our current prototype, running — a purpose-built sketching environment with a real drawing engine. We are at TRL 3, and we are applying to GENESIS EIR to reach a validated TRL 4 tutoring prototype.`,
  });

  // The cover carries only the corner guide and registration mark: a full-width
  // horizon rule reads as an accidental band against the dark ground.
  slide.addShape(pptx.ShapeType.line, {
    x: 11.1,
    y: 0.62,
    w: 2.233,
    h: 0.44,
    line: { color: C.darkBorder, width: 0.5 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.5,
    y: 7.1,
    w: 0.16,
    h: 0,
    line: { color: C.darkBorder, width: 0.75 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.58,
    y: 7.02,
    w: 0,
    h: 0.16,
    line: { color: C.darkBorder, width: 0.75 },
  });

  slide.addImage({ path: path.join(assets, "folio-icon.png"), x: M.left, y: 0.52, w: 0.4, h: 0.4 });
  slide.addText("FOLIO", {
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    charSpacing: 3.4,
    color: C.inkInverse,
    x: M.left + 0.55,
    y: 0.52,
    w: 3,
    h: 0.4,
    valign: "middle",
  });

  slide.addText("AI that teaches you to sketch — instead of sketching for you.", {
    fontFace: FONT,
    fontSize: 37,
    bold: true,
    color: C.inkInverse,
    x: M.left,
    y: 1.72,
    w: 5.75,
    h: 2.35,
    valign: "top",
    lineSpacingMultiple: 1.06,
  });

  slide.addText(
    "A personalised AI tutor that understands how learners draw and provides visual corrections, targeted practice and adaptive progression.",
    {
      fontFace: FONT,
      fontSize: 13,
      color: C.mutedInverse,
      x: M.left,
      y: 4.2,
      w: 5.5,
      h: 0.95,
      valign: "top",
      lineSpacingMultiple: 1.25,
    },
  );

  accentRule(slide, { x: M.left, y: 5.34, w: 0.5, color: C.accentLight });

  slide.addText("Turning every sketch into a learning opportunity.", {
    fontFace: FONT,
    fontSize: 12,
    italic: true,
    color: C.accentLight,
    x: M.left,
    y: 5.58,
    w: 5.5,
    h: 0.3,
  });

  slide.addText(
    [
      { text: "Ritik Pandey", options: { bold: true, color: C.inkInverse, fontSize: 13 } },
      { text: "   Founder, Folio", options: { color: C.mutedInverse, fontSize: 11 } },
    ],
    { fontFace: FONT, x: M.left, y: 6.12, w: 5.5, h: 0.3 },
  );

  slide.addText("AI/ML   •   CREATIVE EDUCATION   •   TRL 3", {
    fontFace: FONT,
    fontSize: 9.5,
    bold: true,
    charSpacing: 1.8,
    color: C.mutedInverse,
    x: M.left,
    y: 6.62,
    w: 6,
    h: 0.28,
  });

  // Product screenshot — the real prototype.
  const shot = path.join(assets, "folio-workspace-sketch.png");
  const size = pngSize(shot);
  const imgW = 6.05;
  const imgH = (imgW * size.height) / size.width;
  const imgX = 13.333 - M.right - imgW;
  const imgY = 2.2;
  slide.addShape(pptx.ShapeType.rect, {
    x: imgX - 0.06,
    y: imgY - 0.06,
    w: imgW + 0.12,
    h: imgH + 0.12,
    fill: { color: C.darkSurface },
    line: { color: C.darkBorder, width: 1 },
  });
  slide.addImage({ path: shot, x: imgX, y: imgY, w: imgW, h: imgH });

  // Deck annotation over the screenshot — clearly a deck mark, not app UI.
  // The arrow points at the drawn top-right edge, which really does rise away
  // from its vanishing point instead of converging toward it.
  const noteW = 1.52;
  const noteX = imgX + imgW * 0.2;
  const noteY = imgY + imgH * 0.14;
  const errorX = imgX + imgW * 0.6;
  const errorY = imgY + imgH * 0.415;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: noteX,
    y: noteY,
    w: noteW,
    h: 0.3,
    fill: { color: C.accentLight },
    line: { color: C.accentLight, width: 0 },
    rectRadius: 0.06,
  });
  slide.addText("Perspective error", {
    fontFace: FONT,
    fontSize: 9,
    bold: true,
    color: "1E1B2E",
    x: noteX,
    y: noteY,
    w: noteW,
    h: 0.3,
    align: "center",
    valign: "middle",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: noteX + noteW,
    y: noteY + 0.15,
    w: errorX - (noteX + noteW),
    h: errorY - (noteY + 0.15),
    line: { color: C.accentLight, width: 1.25, endArrowType: "triangle" },
  });

  slide.addText(
    "Folio prototype, running today. Annotation added for illustration — the tutoring pipeline is under development.",
    {
      fontFace: FONT,
      fontSize: 8.5,
      color: C.mutedInverse,
      x: imgX,
      y: imgY + imgH + 0.22,
      w: imgW,
      h: 0.34,
    },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 2 — Problem
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `There is already an enormous amount of good drawing content available through YouTube, courses and books. So another content library is not the primary problem we want to solve.

The problem appears after the learner starts drawing. If they construct a cube incorrectly, misunderstand perspective, distort a proportion or repeatedly use poor line technique, a prerecorded video cannot look at their work and correct them.

A tutor can — but one-to-one tutoring does not scale economically.

Precision Reports found that around 31% of online art learners report concerns about limited instructor interaction and personalised feedback. That missing feedback loop is the problem Folio is built around.`,
  });
  header(slide, "Problem", "Content is abundant. Feedback is missing.");

  slide.addText("THE LOOP TODAY", { ...T.label, x: M.left, y: 1.72, w: 3.2, h: 0.24 });

  const steps = [
    { text: "Watch tutorial", broken: false },
    { text: "Draw alone", broken: false },
    { text: "Make mistakes", broken: false },
    { text: "No correction", broken: true },
    { text: "Repeat mistakes", broken: true },
  ];
  const stepH = 0.5;
  const stepGap = 0.28;
  steps.forEach((step, index) => {
    const y = 2.08 + index * (stepH + stepGap);
    card(slide, {
      x: M.left,
      y,
      w: 3.2,
      h: stepH,
      fill: step.broken ? C.bg : C.surface,
      line: step.broken ? C.borderStrong : C.border,
      dash: step.broken ? "dash" : undefined,
    });
    slide.addText(step.text, {
      ...T.body,
      bold: !step.broken,
      color: step.broken ? C.muted : C.ink,
      x: M.left + 0.24,
      y,
      w: 2.8,
      h: stepH,
      valign: "middle",
    });
    if (index < steps.length - 1) {
      arrow(slide, {
        x: M.left + 1.6,
        y: y + stepH + 0.05,
        w: 0,
        h: stepGap - 0.1,
        color: step.broken ? C.borderStrong : C.faint,
      });
    }
  });

  // Supporting points.
  const points = [
    [
      "Online material demonstrates technique.",
      "It cannot continuously observe each individual learner while they work.",
    ],
    [
      "Uncorrected mistakes become habits.",
      "Proportion, perspective, construction and line control are all learned by correction.",
    ],
    [
      "One-to-one tutoring does solve this.",
      "But it is expensive, time-bound and fundamentally difficult to scale.",
    ],
  ];
  const px = 4.75;
  const pw = CONTENT_W - (px - M.left);
  points.forEach((point, index) => {
    const y = 1.72 + index * 0.86;
    dot(slide, { x: px, y: y + 0.11, size: 0.1 });
    slide.addText(point[0], {
      ...T.body,
      bold: true,
      fontSize: 12.5,
      x: px + 0.26,
      y,
      w: pw - 0.26,
      h: 0.3,
    });
    slide.addText(point[1], {
      ...T.small,
      x: px + 0.26,
      y: y + 0.32,
      w: pw - 0.4,
      h: 0.44,
      lineSpacingMultiple: 1.2,
    });
  });

  // Highlight statistic.
  card(slide, { x: px, y: 4.42, w: pw, h: 1.42, fill: C.accentSofter, line: C.accentSoft });
  slide.addText("31%", {
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: C.accent,
    x: px + 0.28,
    y: 4.6,
    w: 1.9,
    h: 0.8,
    valign: "middle",
  });
  slide.addText(
    "of online art learners report concerns around limited instructor interaction and personalised feedback.",
    {
      ...T.body,
      fontSize: 12.5,
      x: px + 2.24,
      y: 4.62,
      w: pw - 2.55,
      h: 0.7,
      valign: "middle",
      lineSpacingMultiple: 1.2,
    },
  );
  slide.addText("Source: Precision Reports, Online Art Courses Market, June 2026.", {
    ...T.micro,
    x: px + 2.24,
    y: 5.38,
    w: pw - 2.55,
    h: 0.24,
  });

  // Bottom line.
  slide.addShape(pptx.ShapeType.line, {
    x: M.left,
    y: 6.28,
    w: CONTENT_W,
    h: 0,
    line: { color: C.border, width: 1 },
  });
  slide.addText(
    [
      { text: "The internet solved access to instruction.  ", options: { color: C.muted } },
      { text: "It has not solved access to feedback.", options: { color: C.ink, bold: true } },
    ],
    { fontFace: FONT, fontSize: 16, x: M.left, y: 6.44, w: CONTENT_W, h: 0.4, valign: "middle" },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 3 — Solution
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `Folio creates the feedback loop that is missing from conventional online learning.

The important distinction is that we do not want AI to replace the act of drawing. The learner must still draw.

Folio observes that process, identifies weaknesses, explains them visually on the canvas, and then chooses what the learner should practise next.

Over time the system builds a model of that learner's skills, rather than treating every drawing as an isolated image. That is the difference between an image generator and a tutor.`,
  });
  header(slide, "Solution", "A continuous AI feedback loop for learning sketching.");

  const stages = [
    ["DRAW", "The learner sketches naturally inside Folio."],
    ["OBSERVE", "Folio captures the drawing and how it was constructed."],
    ["DIAGNOSE", "AI identifies specific technical weaknesses."],
    ["CORRECT", "Visual guidance appears in context on the canvas."],
    ["PRACTICE", "Folio recommends an exercise for that weakness."],
    ["ADAPT", "The learner model updates lessons and difficulty."],
  ];
  const boxW = 1.78;
  const boxGap = (CONTENT_W - stages.length * boxW) / (stages.length - 1);
  const boxY = 2.0;
  const boxH = 0.62;

  stages.forEach((stage, index) => {
    const x = M.left + index * (boxW + boxGap);
    const isAi = index >= 1 && index <= 4;
    card(slide, {
      x,
      y: boxY,
      w: boxW,
      h: boxH,
      fill: isAi ? C.accentSofter : C.surface,
      line: isAi ? C.accentSoft : C.border,
    });
    slide.addText(stage[0], {
      fontFace: FONT,
      fontSize: 11.5,
      bold: true,
      charSpacing: 1.2,
      color: isAi ? C.accentDeep : C.ink,
      x,
      y: boxY,
      w: boxW,
      h: boxH,
      align: "center",
      valign: "middle",
    });
    slide.addText(stage[1], {
      ...T.small,
      fontSize: 9.5,
      x: x - 0.04,
      y: boxY + boxH + 0.16,
      w: boxW + 0.08,
      h: 0.72,
      align: "center",
      valign: "top",
      lineSpacingMultiple: 1.16,
    });
    if (index < stages.length - 1) {
      arrow(slide, {
        x: x + boxW + 0.05,
        y: boxY + boxH / 2,
        w: boxGap - 0.1,
        h: 0,
        color: C.borderStrong,
      });
    }
  });

  // Return loop back to DRAW. The verticals run outside the column text so the
  // path never crosses a stage description.
  const loopY = 3.98;
  const midY = boxY + boxH / 2;
  const leftRail = M.left - 0.3;
  const rightRail = 13.333 - M.right + 0.3;
  const lastRight = M.left + (stages.length - 1) * (boxW + boxGap) + boxW;
  slide.addShape(pptx.ShapeType.line, {
    x: lastRight,
    y: midY,
    w: rightRail - lastRight,
    h: 0,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: rightRail,
    y: midY,
    w: 0,
    h: loopY - midY,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: leftRail,
    y: loopY,
    w: rightRail - leftRail,
    h: 0,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: leftRail,
    y: midY,
    w: 0,
    h: loopY - midY,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: leftRail,
    y: midY,
    w: M.left - leftRail,
    h: 0,
    line: { color: C.accent, width: 1.25, endArrowType: "triangle" },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 5.2,
    y: loopY - 0.15,
    w: 2.95,
    h: 0.3,
    fill: { color: C.bg },
    line: { color: C.bg, width: 1 },
  });
  slide.addText("CONTINUOUS ADAPTIVE LOOP", {
    ...T.label,
    fontSize: 8.5,
    color: C.accent,
    x: 5.2,
    y: loopY - 0.15,
    w: 2.95,
    h: 0.3,
    align: "center",
    valign: "middle",
  });

  // The contrast that defines the product.
  const cw = (CONTENT_W - 0.3) / 2;
  card(slide, { x: M.left, y: 4.58, w: cw, h: 1.45, fill: C.bg, line: C.borderStrong, dash: "dash" });
  slide.addText("NOT THIS", { ...T.label, x: M.left + 0.3, y: 4.78, w: cw - 0.6, h: 0.24 });
  slide.addText("“Here is a better drawing.”", {
    fontFace: FONT,
    fontSize: 19,
    color: C.muted,
    x: M.left + 0.3,
    y: 5.1,
    w: cw - 0.6,
    h: 0.8,
    valign: "top",
  });

  const rx = M.left + cw + 0.3;
  card(slide, { x: rx, y: 4.58, w: cw, h: 1.45, fill: C.accentSofter, line: C.accent });
  slide.addText("FOLIO", { ...T.label, color: C.accent, x: rx + 0.3, y: 4.78, w: cw - 0.6, h: 0.24 });
  slide.addText("“Here is what went wrong, why it went wrong, and how to practise it.”", {
    fontFace: FONT,
    fontSize: 19,
    bold: true,
    color: C.ink,
    x: rx + 0.3,
    y: 5.1,
    w: cw - 0.6,
    h: 0.88,
    valign: "top",
    lineSpacingMultiple: 1.05,
  });

  slide.addText(
    "The learner still does the drawing. Folio does the observing, diagnosing and teaching.",
    { ...T.small, x: M.left, y: 6.24, w: CONTENT_W, h: 0.3 },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 4 — Product experience
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `This is where Folio differs from putting a chatbot next to a canvas.

Everything you see in this screenshot is the real prototype: the sketching canvas, the tool dock, the pencil and pen engine, the tool options panel, layers and colour. The box on the canvas was drawn through the real drawing pipeline.

If the learner is practising perspective, feedback should appear on the geometry they actually drew. In this example the top-right edge rises away from its vanishing point instead of converging toward it. Folio should show that edge, display the correct construction direction, explain the principle in one sentence, and immediately ask the learner to retry.

To be explicit: the canvas and tools are built. The AI feedback overlay on this slide is a design illustration. Building and validating that pipeline is exactly what we are applying to GENESIS for.`,
  });
  header(slide, "Product experience", "Feedback directly where learning happens.");

  const shot = path.join(assets, "folio-workspace-sketch.png");
  const size = pngSize(shot);
  const imgW = 7.3;
  const imgH = (imgW * size.height) / size.width;
  const imgX = M.left;
  const imgY = 1.72;
  slide.addShape(pptx.ShapeType.rect, {
    x: imgX - 0.05,
    y: imgY - 0.05,
    w: imgW + 0.1,
    h: imgH + 0.1,
    fill: { color: C.surface },
    line: { color: C.border, width: 1 },
  });
  slide.addImage({ path: shot, x: imgX, y: imgY, w: imgW, h: imgH });

  // Numbered markers over the real UI.
  const markers = [
    { n: "1", x: imgX + imgW * 0.5, y: imgY + imgH * 0.62 },
    { n: "2", x: imgX + imgW * 0.045, y: imgY + imgH * 0.45 },
    { n: "3", x: imgX + imgW * 0.665, y: imgY + imgH * 0.38 },
    { n: "4", x: imgX + imgW * 0.945, y: imgY + imgH * 0.3 },
  ];
  markers.forEach((marker) => {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: marker.x - 0.13,
      y: marker.y - 0.13,
      w: 0.26,
      h: 0.26,
      fill: { color: C.accent },
      line: { color: C.surface, width: 1 },
    });
    slide.addText(marker.n, {
      fontFace: FONT,
      fontSize: 9,
      bold: true,
      color: "FFFFFF",
      x: marker.x - 0.13,
      y: marker.y - 0.13,
      w: 0.26,
      h: 0.26,
      align: "center",
      valign: "middle",
    });
  });

  // Illustrative correction overlay on the drawn error.
  const errX = imgX + imgW * 0.47;
  const errY = imgY + imgH * 0.4;
  slide.addShape(pptx.ShapeType.line, {
    x: errX,
    y: errY + 0.02,
    w: imgW * 0.19,
    h: imgH * 0.055,
    line: { color: C.accent, width: 1.5, dashType: "dash" },
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: errX + 0.16,
    y: errY + 0.4,
    w: 1.28,
    h: 0.22,
    fill: { color: C.surface },
    line: { color: C.accentSoft, width: 0.75 },
    rectRadius: 0.04,
  });
  slide.addText("expected convergence", {
    fontFace: FONT,
    fontSize: 7,
    bold: true,
    color: C.accentDeep,
    x: errX + 0.16,
    y: errY + 0.4,
    w: 1.28,
    h: 0.22,
    align: "center",
    valign: "middle",
    margin: 0,
  });

  slide.addText(
    "Illustrative AI tutoring workflow. The canvas, tools and strokes are the real Folio prototype; the dashed correction overlay and the tutor panel are design illustrations. The tutoring pipeline is under development.",
    {
      ...T.micro,
      x: imgX,
      y: imgY + imgH + 0.14,
      w: imgW,
      h: 0.44,
      lineSpacingMultiple: 1.2,
    },
  );

  // Right column: the illustrative scenario.
  const rx = M.left + imgW + 0.42;
  const rw = CONTENT_W - imgW - 0.42;

  card(slide, { x: rx, y: 1.72, w: rw, h: 1.32, fill: C.surface, line: C.border });
  slide.addText("EXERCISE", { ...T.label, x: rx + 0.24, y: 1.86, w: rw - 0.48, h: 0.22 });
  slide.addText("Draw a box in two-point perspective.", {
    ...T.body,
    fontSize: 13,
    bold: true,
    x: rx + 0.24,
    y: 2.1,
    w: rw - 0.48,
    h: 0.46,
    valign: "top",
  });
  slide.addText("The learner draws. Folio watches how it was constructed.", {
    ...T.small,
    fontSize: 9.5,
    x: rx + 0.24,
    y: 2.56,
    w: rw - 0.48,
    h: 0.4,
    lineSpacingMultiple: 1.15,
  });

  card(slide, { x: rx, y: 3.2, w: rw, h: 2.5, fill: C.accentSofter, line: C.accentSoft });
  slide.addText("ILLUSTRATIVE FOLIO RESPONSE", {
    ...T.label,
    color: C.accent,
    x: rx + 0.24,
    y: 3.38,
    w: rw - 0.48,
    h: 0.22,
  });
  // Heights are explicit so a line that wraps cannot crowd the next bullet.
  const responses = [
    ["Top-right edge diverges from its vanishing point", 0.38],
    ["Vertical edges not consistently parallel", 0.38],
    ["Overlays the expected vanishing direction", 0.38],
    ["Explains the principle in one sentence", 0.38],
    ["Asks the learner to retry, and records the result", 0.38],
  ];
  let responseY = 3.68;
  responses.forEach(([line, height]) => {
    dot(slide, { x: rx + 0.26, y: responseY + 0.07, size: 0.075, color: C.accent });
    slide.addText(line, {
      ...T.body,
      fontSize: 9.5,
      x: rx + 0.46,
      y: responseY,
      w: rw - 0.72,
      h: height,
      valign: "top",
      lineSpacingMultiple: 1.1,
    });
    responseY += height;
  });

  const legend = [
    ["1", "Purpose-built sketching canvas", "built"],
    ["2", "Drawing tools & tool options", "built"],
    ["3", "Contextual visual feedback", "illustrative"],
    ["4", "AI tutor & skill progression", "illustrative"],
  ];
  legend.forEach((item, index) => {
    const y = 5.86 + index * 0.28;
    slide.addText(
      [
        { text: `${item[0]}  `, options: { bold: true, color: C.accent } },
        { text: item[1], options: { color: C.ink } },
        {
          text: `   ${item[2] === "built" ? "built" : "illustrative"}`,
          options: { color: item[2] === "built" ? C.accent : C.faint, italic: true },
        },
      ],
      { fontFace: FONT, fontSize: 9, x: rx, y, w: rw, h: 0.26, valign: "middle" },
    );
  });
}

// ---------------------------------------------------------------------------
// SLIDE 5 — Technology / core innovation
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `The technological advantage we want to build is the intelligence around the drawing process itself.

A finished image tells us what the learner produced. Stroke history can tell us how they produced it — the order, the timing, the hesitations, the corrections, the undo behaviour.

Combining those signals with geometric analysis, computer vision, multimodal models and learner history gives Folio much richer context for teaching than a photograph of a finished drawing.

I want to be precise about the claim: the drawing engine at the top of this pipeline is built and working. Everything below it is what GENESIS EIR would fund. And we do not claim a proprietary foundation model — our intended moat is first-party drawing-process data, sketch understanding, learner history and the pedagogical layer.`,
  });
  header(slide, "Technology / core innovation", "The drawing process becomes learning data.");

  const layers = [
    ["DIGITAL DRAWING ENGINE", "Purpose-built environment for sketching and learning."],
    ["STROKE TELEMETRY", "Coordinates, order, timing, pressure where available, tool, undo."],
    ["SKETCH UNDERSTANDING", "Geometry + vision: perspective, proportion, form, construction."],
    ["LEARNER MODEL", "Recurring errors, mastered concepts, current skill level."],
    ["MULTIMODAL AI TUTOR", "Reasons across drawing, stroke history, objective and learner."],
    ["VISUAL FEEDBACK + ADAPTIVE PRACTICE", "On-canvas correction and the next targeted exercise."],
  ];
  const lw = 4.95;
  const lh = 0.6;
  const lgap = 0.24;
  const ly0 = 1.78;

  layers.forEach((layer, index) => {
    const y = ly0 + index * (lh + lgap);
    const built = index === 0;
    card(slide, {
      x: M.left,
      y,
      w: lw,
      h: lh,
      fill: built ? C.accentSoft : C.surface,
      line: built ? C.accent : C.border,
    });
    slide.addText(layer[0], {
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      charSpacing: 0.8,
      color: built ? C.accentDeep : C.ink,
      x: M.left + 0.22,
      y: y + 0.07,
      w: lw - 0.44,
      h: 0.22,
    });
    slide.addText(layer[1], {
      ...T.micro,
      color: built ? C.accentDeep : C.muted,
      x: M.left + 0.22,
      y: y + 0.29,
      w: lw - 0.44,
      h: 0.24,
    });
    if (index < layers.length - 1) {
      arrow(slide, { x: M.left + 0.55, y: y + lh + 0.03, w: 0, h: lgap - 0.06, color: C.borderStrong });
    }
  });

  chip(slide, {
    x: M.left + lw - 1.36,
    y: ly0 + 0.17,
    w: 1.2,
    h: 0.26,
    text: "BUILT TODAY",
    fill: C.accent,
    color: "FFFFFF",
  });

  // Bracket marking the GENESIS scope.
  const brX = M.left + lw + 0.16;
  const brY0 = ly0 + (lh + lgap);
  const brY1 = ly0 + layers.length * (lh + lgap) - lgap;
  slide.addShape(pptx.ShapeType.line, {
    x: brX,
    y: brY0,
    w: 0,
    h: brY1 - brY0,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: brX,
    y: brY0,
    w: 0.14,
    h: 0,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: brX,
    y: brY1,
    w: 0.14,
    h: 0,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addText("TRL 3 → TRL 4\nGENESIS EIR\nSCOPE", {
    fontFace: FONT,
    fontSize: 8.5,
    bold: true,
    color: C.accent,
    x: brX + 0.16,
    y: (brY0 + brY1) / 2 - 0.34,
    w: 1.2,
    h: 0.68,
    valign: "middle",
    lineSpacingMultiple: 1.2,
    margin: 0,
  });

  // Moat.
  const mx = 7.4;
  const mw = 13.333 - M.right - mx;
  slide.addText("Our moat is not the LLM alone.", {
    fontFace: FONT,
    fontSize: 21,
    bold: true,
    color: C.ink,
    x: mx,
    y: 1.72,
    w: mw,
    h: 0.42,
  });
  slide.addText("It is the combination of four things a general model does not have.", {
    ...T.small,
    x: mx,
    y: 2.16,
    w: mw,
    h: 0.28,
  });

  const moat = [
    ["FIRST-PARTY DRAWING PROCESS DATA", "How the drawing was made, not just how it looks."],
    ["SKETCH UNDERSTANDING", "Geometry and vision tuned to teaching, not to generation."],
    ["LEARNER HISTORY", "Every attempt, error and correction over time."],
    ["PEDAGOGICAL FEEDBACK", "Knowing what to say next, and what to practise next."],
  ];
  const mcw = (mw - 0.22) / 2;
  const mch = 1.24;
  moat.forEach((item, index) => {
    const x = mx + (index % 2) * (mcw + 0.22);
    const y = 2.6 + Math.floor(index / 2) * (mch + 0.22);
    card(slide, { x, y, w: mcw, h: mch, fill: C.surface, line: C.border });
    accentRule(slide, { x: x + 0.22, y: y + 0.22 });
    slide.addText(item[0], {
      fontFace: FONT,
      fontSize: 9.5,
      bold: true,
      charSpacing: 0.6,
      color: C.ink,
      x: x + 0.22,
      y: y + 0.36,
      w: mcw - 0.44,
      h: 0.44,
      valign: "top",
      lineSpacingMultiple: 1.05,
    });
    slide.addText(item[1], {
      ...T.micro,
      x: x + 0.22,
      y: y + 0.82,
      w: mcw - 0.44,
      h: 0.32,
      lineSpacingMultiple: 1.15,
    });
  });

  card(slide, { x: mx, y: 5.44, w: mw, h: 0.82, fill: C.bg, line: C.border, dash: "dash" });
  slide.addText(
    "Folio does not claim a proprietary foundation model. The defensible asset is the drawing-process dataset and the teaching layer built around it.",
    {
      ...T.small,
      fontSize: 9.5,
      color: C.ink,
      x: mx + 0.24,
      y: 5.44,
      w: mw - 0.48,
      h: 0.82,
      valign: "middle",
      lineSpacingMultiple: 1.2,
    },
  );

  slide.addText(
    "Signals available from the canvas:  x/y coordinates  •  stroke order  •  timing  •  pressure where available  •  tool selection  •  undo and correction behaviour",
    { ...T.micro, x: mx, y: 6.4, w: mw, h: 0.42, lineSpacingMultiple: 1.2 },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 6 — Market opportunity
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `We are entering a growing existing behaviour rather than trying to create one. People are already learning creative skills digitally.

The global online art-course market is estimated at approximately 2.75 billion dollars in 2026, projected to reach roughly 8.82 billion by 2035, at a 13.85 percent compound annual growth rate. More than 120 million learners participate globally in online art-related education.

More importantly for our thesis, the same research identifies limited instructor interaction and personalised feedback as a concern for around 31 percent of learners. That is the gap we are building into.

In India, EdTech was 3.63 billion dollars in 2025 and is projected at 33.31 billion by 2034.

I want to be careful here: these are relevant market indicators, not Folio's addressable market. Our initial beachhead is much narrower — self-directed sketching learners and art, design and architecture students aged roughly 15 to 30.`,
  });
  header(slide, "Market opportunity", "A growing digital-learning market with a clear feedback gap.");

  slide.addText("RELEVANT MARKET INDICATORS  —  NOT A CLAIMED ADDRESSABLE MARKET", {
    ...T.label,
    color: C.faint,
    x: M.left,
    y: 1.66,
    w: CONTENT_W,
    h: 0.22,
  });

  const globals = [
    ["$2.75B", "Global online art-course market, 2026", "USD 2,746.29 million"],
    ["$8.82B", "Projected global market by 2035", "USD 8,823.21 million"],
    ["13.85%", "CAGR, 2026–2035", "Compound annual growth"],
  ];
  const gw = (CONTENT_W - 0.28) / 3;
  globals.forEach((item, index) => {
    const x = M.left + index * (gw + 0.14);
    card(slide, { x, y: 1.98, w: gw, h: 1.34, fill: C.surface, line: C.border });
    slide.addText(item[0], {
      fontFace: FONT,
      fontSize: 38,
      bold: true,
      color: index === 2 ? C.accent : C.ink,
      x: x + 0.26,
      y: 2.14,
      w: gw - 0.52,
      h: 0.62,
    });
    slide.addText(item[1], {
      ...T.body,
      fontSize: 10.5,
      x: x + 0.26,
      y: 2.78,
      w: gw - 0.52,
      h: 0.26,
    });
    slide.addText(item[2], { ...T.micro, x: x + 0.26, y: 3.02, w: gw - 0.52, h: 0.22 });
  });

  const pair = [
    ["120M+", "learners participate globally in online art-related education"],
    ["31%", "report concerns around limited instructor interaction and personalised feedback"],
  ];
  const qw = (CONTENT_W - 0.14) / 2;
  pair.forEach((item, index) => {
    const x = M.left + index * (qw + 0.14);
    card(slide, { x, y: 3.48, w: qw, h: 0.94, fill: C.accentSofter, line: C.accentSoft });
    slide.addText(item[0], {
      fontFace: FONT,
      fontSize: 24,
      bold: true,
      color: C.accent,
      x: x + 0.26,
      y: 3.48,
      w: 1.5,
      h: 0.94,
      valign: "middle",
    });
    slide.addText(item[1], {
      ...T.body,
      fontSize: 10.5,
      x: x + 1.84,
      y: 3.48,
      w: qw - 2.1,
      h: 0.94,
      valign: "middle",
      lineSpacingMultiple: 1.18,
    });
  });

  // India context.
  card(slide, { x: M.left, y: 4.58, w: CONTENT_W, h: 1.06, fill: C.surface, line: C.border });
  slide.addText("INDIA", {
    ...T.label,
    color: C.accent,
    x: M.left + 0.26,
    y: 4.58,
    w: 1.1,
    h: 1.06,
    valign: "middle",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: M.left + 1.42,
    y: 4.78,
    w: 0,
    h: 0.66,
    line: { color: C.border, width: 1 },
  });
  slide.addText(
    [
      { text: "$3.63B", options: { fontSize: 22, bold: true, color: C.ink } },
      { text: "   Indian EdTech market, 2025", options: { fontSize: 10.5, color: C.muted } },
    ],
    { fontFace: FONT, x: M.left + 1.7, y: 4.58, w: 4.6, h: 1.06, valign: "middle" },
  );
  arrow(slide, { x: 6.6, y: 5.11, w: 0.5, h: 0, color: C.borderStrong });
  slide.addText(
    [
      { text: "$33.31B", options: { fontSize: 22, bold: true, color: C.accent } },
      { text: "   projected by 2034", options: { fontSize: 10.5, color: C.muted } },
    ],
    { fontFace: FONT, x: 7.35, y: 4.58, w: 5.15, h: 1.06, valign: "middle" },
  );

  // Beachhead.
  slide.addText(
    [
      { text: "BEACHHEAD   ", options: { fontSize: 9, bold: true, charSpacing: 1.4, color: C.accent } },
      {
        text: "Students and young adults aged 15–30 learning sketching independently, or through art, architecture and design education.",
        options: { fontSize: 11.5, color: C.ink },
      },
    ],
    { fontFace: FONT, x: M.left, y: 5.86, w: CONTENT_W, h: 0.36, valign: "middle" },
  );

  slide.addShape(pptx.ShapeType.line, {
    x: M.left,
    y: 6.42,
    w: CONTENT_W,
    h: 0,
    line: { color: C.border, width: 1 },
  });
  slide.addText(
    "Sources: Precision Reports, Online Art Courses Market, June 2026.  •  India Brand Equity Foundation (IBEF), Education Industry Report, May 2026.\nThese figures describe the surrounding market, not Folio's addressable market.",
    { ...T.micro, x: M.left, y: 6.54, w: CONTENT_W, h: 0.44, lineSpacingMultiple: 1.25 },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 7 — Business model
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `Our initial model is intentionally simple: freemium business-to-consumer.

The drawing environment and some foundation exercises stay accessible for free. Continuous personalised AI feedback, adaptive practice and skill progression become the paid tier.

We are deliberately not quoting a price today. Pricing will be validated during pilot testing — quoting a number we have not tested would not be honest.

Once the tutoring technology is validated, the same sketch-understanding capability can support institutions, and can be offered as a sketch-analysis or tutoring API. But business-to-consumer is the initial focus, because that is also what generates the drawing-process data the technology needs.`,
  });
  header(slide, "Business model", "Consumer subscription first. Platform opportunities later.");

  const tiers = [
    {
      name: "FREE",
      note: "Adoption and data",
      items: [
        "Core sketching tools",
        "Foundation exercises",
        "Limited learning features",
      ],
      accent: false,
      dash: false,
    },
    {
      name: "FOLIO PRO",
      note: "Primary revenue model",
      items: [
        "Personalised AI feedback",
        "Adaptive practice",
        "Advanced learning paths",
        "Skill progression",
        "Progress analytics",
      ],
      accent: true,
      dash: false,
    },
    {
      name: "B2B / PLATFORM",
      note: "Future",
      items: [
        "Institution licensing",
        "Art & design school deployments",
        "Sketch-analysis API",
        "Tutoring API / SDK",
      ],
      accent: false,
      dash: true,
    },
  ];
  const tw = (CONTENT_W - 0.28) / 3;
  const th = 3.82;
  tiers.forEach((tier, index) => {
    const x = M.left + index * (tw + 0.14);
    card(slide, {
      x,
      y: 1.78,
      w: tw,
      h: th,
      fill: tier.accent ? C.accentSofter : C.surface,
      line: tier.accent ? C.accent : C.border,
      dash: tier.dash ? "dash" : undefined,
    });
    slide.addText(tier.name, {
      fontFace: FONT,
      fontSize: 15,
      bold: true,
      charSpacing: 1.2,
      color: tier.accent ? C.accentDeep : C.ink,
      x: x + 0.3,
      y: 2.04,
      w: tw - 0.6,
      h: 0.32,
    });
    slide.addText(tier.note.toUpperCase(), {
      ...T.label,
      fontSize: 8,
      color: tier.accent ? C.accent : C.faint,
      x: x + 0.3,
      y: 2.38,
      w: tw - 0.6,
      h: 0.22,
    });
    slide.addShape(pptx.ShapeType.line, {
      x: x + 0.3,
      y: 2.74,
      w: tw - 0.6,
      h: 0,
      line: { color: tier.accent ? C.accentSoft : C.border, width: 1 },
    });
    tier.items.forEach((item, itemIndex) => {
      const y = 2.94 + itemIndex * 0.38;
      dot(slide, {
        x: x + 0.32,
        y: y + 0.08,
        size: 0.075,
        color: tier.accent ? C.accent : C.borderStrong,
      });
      slide.addText(item, {
        ...T.body,
        fontSize: 10.5,
        x: x + 0.54,
        y,
        w: tw - 0.84,
        h: 0.34,
        valign: "top",
      });
    });
    if (tier.accent) {
      chip(slide, {
        x: x + 0.3,
        y: 1.78 + th - 0.66,
        w: tw - 0.6,
        h: 0.44,
        text: "PRICING TO BE VALIDATED DURING PILOT TESTING",
        fill: C.accent,
        color: "FFFFFF",
      });
    }
  });

  // Sequencing.
  const flow = ["B2C learner product", "Validated tutoring technology", "B2B + API platform"];
  const fw = 3.3;
  const fgap = (CONTENT_W - flow.length * fw) / (flow.length - 1);
  flow.forEach((step, index) => {
    const x = M.left + index * (fw + fgap);
    card(slide, { x, y: 5.84, w: fw, h: 0.54, fill: C.bg, line: C.borderStrong });
    slide.addText(step, {
      ...T.body,
      fontSize: 11,
      bold: true,
      x,
      y: 5.84,
      w: fw,
      h: 0.54,
      align: "center",
      valign: "middle",
    });
    if (index < flow.length - 1) {
      arrow(slide, { x: x + fw + 0.12, y: 6.11, w: fgap - 0.24, h: 0, color: C.accent });
    }
  });

  slide.addText(
    "The consumer product creates both revenue and the drawing-process data required to improve the underlying teaching technology.",
    { ...T.small, x: M.left, y: 6.56, w: CONTENT_W, h: 0.3, align: "center" },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 8 — Go-to-market
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `Our first users are concentrated in communities we can reach cheaply.

We start with a closed pilot of thirty to fifty learners drawn from art, design and architecture students and self-taught sketching communities. The goal there is not growth — it is validating feedback quality and learning the real error distribution.

Then creator-led beta. Sketching is highly visual, which makes creator distribution unusually effective. A creator can set an exercise, their audience attempts it in Folio, and the feedback itself becomes shareable content — the before-and-after is the advertisement.

That feeds a freemium launch through campus communities and referrals, and finally institutional pilots with art institutes, design schools and architecture colleges.`,
  });
  header(slide, "Go-to-market", "Start where sketching learners already gather.");

  const phases = [
    {
      n: "01",
      name: "CLOSED PILOT",
      lead: "30–50 learners",
      items: [
        "Art, design and architecture students",
        "Self-taught sketching communities",
        "Validate feedback quality and retention",
      ],
    },
    {
      n: "02",
      name: "CREATOR-LED BETA",
      lead: "Distribution through educators",
      items: [
        "Sketching educators and YouTubers",
        "Instagram artists and art communities",
        "Feedback becomes shareable content",
      ],
    },
    {
      n: "03",
      name: "FREEMIUM LAUNCH",
      lead: "Community-driven growth",
      items: [
        "Campus communities and ambassadors",
        "Drawing challenges and referrals",
        "Tutorial and creator content",
      ],
    },
    {
      n: "04",
      name: "B2B PILOTS",
      lead: "Institutional deployment",
      items: [
        "Art institutes",
        "Design schools",
        "Architecture colleges",
      ],
    },
  ];
  const pw = (CONTENT_W - 3 * 0.17) / 4;
  phases.forEach((phase, index) => {
    const x = M.left + index * (pw + 0.17);
    card(slide, { x, y: 1.76, w: pw, h: 2.62, fill: C.surface, line: C.border });
    slide.addText(phase.n, {
      fontFace: FONT,
      fontSize: 22,
      bold: true,
      color: C.accentSoft,
      x: x + 0.24,
      y: 1.86,
      w: pw - 0.48,
      h: 0.4,
    });
    slide.addText(phase.name, {
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      charSpacing: 1,
      color: C.ink,
      x: x + 0.24,
      y: 2.3,
      w: pw - 0.48,
      h: 0.26,
    });
    slide.addText(phase.lead, {
      ...T.micro,
      color: C.accent,
      x: x + 0.24,
      y: 2.56,
      w: pw - 0.48,
      h: 0.22,
    });
    slide.addShape(pptx.ShapeType.line, {
      x: x + 0.24,
      y: 2.86,
      w: pw - 0.48,
      h: 0,
      line: { color: C.border, width: 1 },
    });
    phase.items.forEach((item, itemIndex) => {
      slide.addText(item, {
        ...T.small,
        fontSize: 9,
        color: C.ink,
        x: x + 0.24,
        y: 2.98 + itemIndex * 0.44,
        w: pw - 0.48,
        h: 0.4,
        valign: "top",
        lineSpacingMultiple: 1.15,
      });
    });
    if (index < phases.length - 1) {
      arrow(slide, { x: x + pw + 0.03, y: 3.07, w: 0.11, h: 0, color: C.borderStrong });
    }
  });

  // Creator acquisition loop.
  card(slide, { x: M.left, y: 4.64, w: CONTENT_W, h: 1.86, fill: C.accentSofter, line: C.accentSoft });
  slide.addText("THE CREATOR ACQUISITION LOOP", {
    ...T.label,
    color: C.accent,
    x: M.left + 0.3,
    y: 4.84,
    w: 5,
    h: 0.22,
  });

  const loop = [
    "Creator publishes an exercise",
    "Audience attempts it in Folio",
    "Folio returns visual feedback",
    "Learners share their improvement",
    "New learners discover Folio",
  ];
  const lw2 = 2.05;
  const lgap2 = (CONTENT_W - 0.6 - loop.length * lw2) / (loop.length - 1);
  loop.forEach((step, index) => {
    const x = M.left + 0.3 + index * (lw2 + lgap2);
    card(slide, { x, y: 5.24, w: lw2, h: 0.66, fill: C.surface, line: C.accentSoft });
    slide.addText(step, {
      ...T.body,
      fontSize: 9,
      x: x + 0.1,
      y: 5.24,
      w: lw2 - 0.2,
      h: 0.66,
      align: "center",
      valign: "middle",
      lineSpacingMultiple: 1.1,
    });
    if (index < loop.length - 1) {
      arrow(slide, { x: x + lw2 + 0.02, y: 5.57, w: lgap2 - 0.04, h: 0, color: C.accent });
    }
  });
  // Return path.
  const loopLastX = M.left + 0.3 + (loop.length - 1) * (lw2 + lgap2) + lw2 / 2;
  slide.addShape(pptx.ShapeType.line, {
    x: loopLastX,
    y: 5.9,
    w: 0,
    h: 0.28,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: M.left + 0.3 + lw2 / 2,
    y: 6.18,
    w: loopLastX - (M.left + 0.3 + lw2 / 2),
    h: 0,
    line: { color: C.accent, width: 1.25 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: M.left + 0.3 + lw2 / 2,
    y: 5.92,
    w: 0,
    h: 0.26,
    line: { color: C.accent, width: 1.25, beginArrowType: "triangle" },
  });

  slide.addText(
    "Product usage and customer acquisition are the same motion: the feedback a learner receives is the content that reaches the next learner.",
    { ...T.small, x: M.left, y: 6.62, w: CONTENT_W, h: 0.3 },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 9 — Competitive positioning
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `A course scales content but not individual attention. A human tutor gives excellent contextual feedback but is expensive and time-constrained. Generative AI can produce impressive images, but producing the result for the user is fundamentally different from teaching the user to create it.

Read the Folio column carefully: it describes the target product architecture. On-canvas correction, adaptive progression and learner memory are design targets, not shipped features — that is precisely what we are asking GENESIS to help us build and validate.

The point of this slide is the framing. We are not competing to generate the best image. We are competing to build the best learning loop.`,
  });
  header(slide, "Competitive positioning", "Existing solutions solve only part of the learning loop.");

  const capabilities = [
    ["Affordable at scale", "Yes", "No", "Yes", "Yes"],
    ["Always available", "Yes", "No", "Yes", "Yes"],
    ["Personalised feedback", "No", "Yes", "Limited", "Yes"],
    ["Observes the drawing process", "No", "Yes", "No", "Yes"],
    ["On-canvas correction", "No", "Yes", "No", "Yes"],
    ["Adaptive progression", "Limited", "Yes", "No", "Yes"],
    ["Learner skill memory", "Limited", "Yes", "No", "Yes"],
  ];

  const headerCells = [
    { text: "CAPABILITY", options: { align: "left", color: C.muted } },
    { text: "COURSES /\nYOUTUBE", options: { align: "center", color: C.muted } },
    { text: "HUMAN\nTUTOR", options: { align: "center", color: C.muted } },
    { text: "GEN-AI DRAWING\nTOOLS", options: { align: "center", color: C.muted } },
    { text: "FOLIO\n(TARGET)", options: { align: "center", color: C.accentDeep, fill: { color: C.accentSoft } } },
  ];

  const rows = [
    headerCells.map((cell) => ({
      text: cell.text,
      options: {
        ...cell.options,
        bold: true,
        fontSize: 9,
        charSpacing: 0.8,
        valign: "middle",
        fill: cell.options.fill ?? { color: C.bg },
      },
    })),
  ];

  capabilities.forEach((row) => {
    rows.push(
      row.map((value, columnIndex) => {
        if (columnIndex === 0) {
          return {
            text: value,
            options: {
              align: "left",
              bold: true,
              fontSize: 10.5,
              color: C.ink,
              valign: "middle",
              fill: { color: C.surface },
            },
          };
        }
        const isFolio = columnIndex === 4;
        const positive = value === "Yes";
        return {
          text: value,
          options: {
            align: "center",
            valign: "middle",
            fontSize: 10.5,
            bold: positive,
            color: isFolio ? C.accentDeep : positive ? C.ink : C.faint,
            fill: { color: isFolio ? C.accentSofter : C.surface },
          },
        };
      }),
    );
  });

  slide.addTable(rows, {
    x: M.left,
    y: 1.68,
    w: CONTENT_W,
    colW: [3.633, 2, 2, 2, 2],
    rowH: [0.44, ...capabilities.map(() => 0.38)],
    border: { type: "solid", color: C.border, pt: 1 },
    fontFace: FONT,
    margin: [0.03, 0.12, 0.03, 0.12],
  });

  slide.addText(
    "The Folio column describes the target product architecture. On-canvas correction, adaptive progression and learner skill memory are not implemented today — they are the TRL 3 → TRL 4 work.",
    { ...T.micro, x: M.left, y: 4.9, w: CONTENT_W, h: 0.3 },
  );

  const summary = [
    ["Courses", "provide content."],
    ["Tutors", "provide feedback."],
    ["Generative AI", "provides output."],
    ["Folio", "is designed to provide feedback that scales."],
  ];
  const sw = (CONTENT_W - 0.42) / 4;
  summary.forEach((item, index) => {
    const x = M.left + index * (sw + 0.14);
    const isFolio = index === 3;
    card(slide, {
      x,
      y: 5.3,
      w: sw,
      h: 0.8,
      fill: isFolio ? C.accentSofter : C.surface,
      line: isFolio ? C.accent : C.border,
    });
    slide.addText(
      [
        {
          text: `${item[0]} `,
          options: { bold: true, color: isFolio ? C.accentDeep : C.ink },
        },
        { text: item[1], options: { color: C.muted } },
      ],
      {
        fontFace: FONT,
        fontSize: 10.5,
        x: x + 0.2,
        y: 5.3,
        w: sw - 0.4,
        h: 0.8,
        valign: "middle",
        lineSpacingMultiple: 1.15,
      },
    );
  });

  slide.addShape(pptx.ShapeType.line, {
    x: M.left,
    y: 6.32,
    w: CONTENT_W,
    h: 0,
    line: { color: C.border, width: 1 },
  });
  slide.addText(
    [
      { text: "We are not competing to generate the best image.  ", options: { color: C.muted } },
      {
        text: "We are competing to build the best learning loop.",
        options: { color: C.ink, bold: true },
      },
    ],
    { fontFace: FONT, fontSize: 15, x: M.left, y: 6.46, w: CONTENT_W, h: 0.4, valign: "middle" },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 10 — Current progress & TRL
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `We deliberately started by building the drawing environment, because an AI tutor depends on understanding the interaction happening inside the canvas. You cannot analyse stroke construction if you do not own the surface the strokes are made on.

That foundation now exists as a functional prototype: a real drawing engine, core tools, custom interactions, a purpose-built interface, and tested critical workflows. We classify the project at TRL 3 — proof of concept.

The right-hand column is the honest gap. Stroke telemetry is architected but not instrumented. Sketch analysis, the multimodal critique, the learner model, on-canvas corrections and the curriculum are all still to build, and then to validate with real learners.

We have built the environment in which learning happens. The next milestone is making that environment understand the learner.`,
  });
  header(slide, "Current progress", "From drawing prototype to intelligent tutor.");

  // TRL ladder.
  const trlGap = 0.08;
  const trlW = (CONTENT_W - 8 * trlGap) / 9;
  const trlX0 = M.left;
  for (let level = 1; level <= 9; level += 1) {
    const x = trlX0 + (level - 1) * (trlW + trlGap);
    const isCurrent = level === 3;
    const isTarget = level === 4;
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 1.68,
      w: trlW,
      h: 0.46,
      fill: { color: isCurrent ? C.accent : isTarget ? C.accentSoft : C.surface },
      line: {
        color: isCurrent ? C.accent : isTarget ? C.accent : C.border,
        width: 1,
        dashType: isTarget ? "dash" : undefined,
      },
      rectRadius: 0.06,
    });
    slide.addText(`TRL ${level}`, {
      fontFace: FONT,
      fontSize: 9.5,
      bold: isCurrent || isTarget,
      color: isCurrent ? "FFFFFF" : isTarget ? C.accentDeep : C.faint,
      x,
      y: 1.68,
      w: trlW,
      h: 0.46,
      align: "center",
      valign: "middle",
    });
  }
  slide.addText("CURRENT", {
    ...T.label,
    fontSize: 8,
    color: C.accent,
    x: trlX0 + 2 * (trlW + trlGap),
    y: 2.2,
    w: trlW,
    h: 0.2,
    align: "center",
  });
  slide.addText("TARGET", {
    ...T.label,
    fontSize: 8,
    color: C.accent,
    x: trlX0 + 3 * (trlW + trlGap),
    y: 2.2,
    w: trlW,
    h: 0.2,
    align: "center",
  });

  const colW = (CONTENT_W - 0.5) / 2;
  const rightX = M.left + colW + 0.5;

  // Achieved.
  slide.addText("ACHIEVED", { ...T.label, color: C.ink, x: M.left, y: 2.7, w: colW, h: 0.22 });
  slide.addText("TRL 3 — Proof of concept / early prototype", {
    ...T.small,
    fontSize: 9.5,
    color: C.accent,
    x: M.left,
    y: 2.92,
    w: colW,
    h: 0.22,
  });
  card(slide, { x: M.left, y: 3.24, w: colW, h: 2.72, fill: C.surface, line: C.border });
  const achieved = [
    "Functional Folio digital-sketching prototype",
    "Core drawing tools — pencil, pen, brush, marker, highlighter",
    "Custom drawing interactions and tool dock",
    "Purpose-built, learning-oriented interface foundation",
    "Tested critical UI workflows — unit and Electron end-to-end",
    "Architecture defined for stroke capture, sketch analysis and AI tutoring",
  ];
  achieved.forEach((item, index) => {
    const y = 3.46 + index * 0.42;
    dot(slide, { x: M.left + 0.26, y: y + 0.08, size: 0.085, color: C.accent });
    slide.addText(item, {
      ...T.body,
      fontSize: 10,
      x: M.left + 0.5,
      y,
      w: colW - 0.76,
      h: 0.38,
      valign: "top",
      lineSpacingMultiple: 1.1,
    });
  });

  // Next.
  slide.addText("NEXT", { ...T.label, color: C.ink, x: rightX, y: 2.7, w: colW, h: 0.22 });
  slide.addText("TRL 3 → TRL 4 — integrated and experimentally validated", {
    ...T.small,
    fontSize: 9.5,
    color: C.accent,
    x: rightX,
    y: 2.92,
    w: colW,
    h: 0.22,
  });
  card(slide, { x: rightX, y: 3.24, w: colW, h: 2.72, fill: C.bg, line: C.borderStrong, dash: "dash" });
  const next = [
    "Instrument the stroke-data pipeline",
    "Build baseline geometric / sketch analysers",
    "Integrate multimodal AI critique",
    "Build the learner-state model",
    "Add contextual on-canvas corrections",
    "Build a structured beginner curriculum",
    "Run a closed pilot with 30–50 learners",
    "Measure feedback quality and learning improvement",
  ];
  next.forEach((item, index) => {
    const y = 3.42 + index * 0.32;
    slide.addText(String(index + 1).padStart(2, "0"), {
      ...T.micro,
      bold: true,
      color: C.borderStrong,
      x: rightX + 0.26,
      y,
      w: 0.34,
      h: 0.28,
      // Without margin:0 the default text inset leaves no room and "01"
      // breaks one digit per line.
      margin: 0,
    });
    slide.addText(item, {
      ...T.body,
      fontSize: 10,
      x: rightX + 0.62,
      y,
      w: colW - 0.88,
      h: 0.28,
      valign: "top",
    });
  });

  card(slide, { x: M.left, y: 6.18, w: CONTENT_W, h: 0.7, fill: C.accentSofter, line: C.accentSoft });
  slide.addText(
    [
      { text: "We have built the environment in which learning happens.  ", options: { color: C.ink } },
      {
        text: "Next, we make that environment understand the learner.",
        options: { color: C.accentDeep, bold: true },
      },
    ],
    {
      fontFace: FONT,
      fontSize: 14,
      x: M.left + 0.3,
      y: 6.18,
      w: CONTENT_W - 0.6,
      h: 0.7,
      valign: "middle",
    },
  );
}

// ---------------------------------------------------------------------------
// SLIDE 11 — GENESIS EIR ask
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `The core risk in Folio today is not whether we can build another drawing application — we have shown we can. It is whether we can turn drawing-process information into feedback that measurably helps people learn.

That is exactly what we want to validate in the next twelve months. Telemetry and an evaluation framework in the first quarter. Multimodal critique and a first tutoring engine by month six. An integrated tutoring MVP and a closed pilot with thirty to fifty learners by month nine. Then measurement of learning outcomes and preparation for institutional pilots.

GENESIS EIR provides up to ten lakh rupees along with incubation and mentorship, and it accepts technologies at TRL 1 to 4. That is a precise fit for where Folio is: a working prototype that now needs to become a validated one.

Our long-term goal is simple — make the kind of personalised feedback currently available mainly through tutors accessible to anyone learning to draw.`,
  });
  header(slide, "GENESIS EIR ask", "GENESIS can help us cross the prototype-to-validation gap.");

  // TRL transition.
  const tcw = 4.9;
  card(slide, { x: M.left, y: 1.56, w: tcw, h: 0.72, fill: C.surface, line: C.border });
  slide.addText(
    [
      { text: "TRL 3   ", options: { fontSize: 15, bold: true, color: C.ink } },
      { text: "Functional drawing prototype", options: { fontSize: 11, color: C.muted } },
    ],
    { fontFace: FONT, x: M.left + 0.26, y: 1.56, w: tcw - 0.52, h: 0.72, valign: "middle" },
  );
  arrow(slide, { x: M.left + tcw + 0.24, y: 1.92, w: 0.72, h: 0, color: C.accent, width: 1.75 });
  const t2x = M.left + tcw + 1.2;
  card(slide, {
    x: t2x,
    y: 1.56,
    w: CONTENT_W - tcw - 1.2,
    h: 0.72,
    fill: C.accentSofter,
    line: C.accent,
  });
  slide.addText(
    [
      { text: "TRL 4   ", options: { fontSize: 15, bold: true, color: C.accentDeep } },
      {
        text: "Integrated & experimentally validated AI tutoring prototype",
        options: { fontSize: 11, color: C.accentDeep },
      },
    ],
    {
      fontFace: FONT,
      x: t2x + 0.26,
      y: 1.56,
      w: CONTENT_W - tcw - 1.72,
      h: 0.72,
      valign: "middle",
    },
  );

  // Milestones.
  const milestones = [
    ["0–3 MONTHS", "Stroke telemetry, evaluation framework and baseline geometric analysis."],
    ["3–6 MONTHS", "Multimodal critique prototype and the initial tutoring / exercise engine."],
    ["6–9 MONTHS", "Integrated AI tutoring MVP and a closed pilot with 30–50 learners."],
    ["9–12 MONTHS", "Measure learning outcomes, improve the learner model, prepare institutional pilots."],
  ];
  const mw2 = (CONTENT_W - 3 * 0.17) / 4;
  milestones.forEach((milestone, index) => {
    const x = M.left + index * (mw2 + 0.17);
    card(slide, { x, y: 2.44, w: mw2, h: 1.28, fill: C.surface, line: C.border });
    accentRule(slide, { x: x + 0.22, y: 2.64 });
    slide.addText(milestone[0], {
      ...T.label,
      fontSize: 8.5,
      color: C.accent,
      x: x + 0.22,
      y: 2.78,
      w: mw2 - 0.44,
      h: 0.2,
    });
    slide.addText(milestone[1], {
      ...T.body,
      fontSize: 10,
      x: x + 0.22,
      y: 3.02,
      w: mw2 - 0.44,
      h: 0.62,
      valign: "top",
      lineSpacingMultiple: 1.15,
    });
  });

  // Indicative budget as a proportional bar. Labels are kept short because the
  // ₹1L column is only about an inch wide.
  slide.addText("INDICATIVE USE OF UP TO ₹10 LAKH", {
    ...T.label,
    color: C.ink,
    x: M.left,
    y: 3.9,
    w: 6,
    h: 0.22,
  });
  const budget = [
    ["₹4L", "AI/ML experimentation, models, APIs and compute", 4, C.accent],
    ["₹3L", "Product and AI integration", 3, "8478C8"],
    ["₹2L", "Pilot deployment and validation", 2, "A79FDA"],
    ["₹1L", "Curriculum and evaluation data", 1, "CFCAEC"],
  ];
  let barX = M.left;
  budget.forEach((item) => {
    const w = (CONTENT_W * item[2]) / 10;
    slide.addShape(pptx.ShapeType.rect, {
      x: barX,
      y: 4.18,
      w,
      h: 0.4,
      fill: { color: item[3] },
      line: { color: C.bg, width: 1 },
    });
    slide.addText(item[0], {
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: item[2] === 1 ? C.accentDeep : "FFFFFF",
      x: barX,
      y: 4.18,
      w,
      h: 0.4,
      align: "center",
      valign: "middle",
    });
    slide.addText(item[1], {
      ...T.micro,
      fontSize: 8,
      color: C.muted,
      x: barX + 0.04,
      y: 4.64,
      w: w - 0.12,
      h: 0.5,
      valign: "top",
      lineSpacingMultiple: 1.15,
      margin: 0,
    });
    barX += w;
  });
  slide.addText(
    "Indicative allocation. Final expenditure is subject to GENESIS EIR funding guidelines. GENESIS EIR Cohort-3 is implemented through MeitY Startup Hub and accepts technologies at TRL 1–4, with financial assistance of up to ₹10 lakh together with incubation and mentorship.",
    { ...T.micro, x: M.left, y: 5.2, w: CONTENT_W, h: 0.4, lineSpacingMultiple: 1.2 },
  );

  // Founder + closing.
  card(slide, { x: M.left, y: 5.74, w: 5.2, h: 0.92, fill: C.surface, line: C.border });
  slide.addText(
    [
      { text: "Ritik Pandey", options: { fontSize: 13, bold: true, color: C.ink } },
      { text: "   Founder", options: { fontSize: 10.5, color: C.muted } },
    ],
    { fontFace: FONT, x: M.left + 0.26, y: 5.86, w: 4.7, h: 0.28 },
  );
  slide.addText(
    "Student founder  •  Building Folio's product and technology  •  Rourkela, Odisha",
    { ...T.micro, x: M.left + 0.26, y: 6.16, w: 4.7, h: 0.4, lineSpacingMultiple: 1.2 },
  );

  slide.addText(
    "Make high-quality personalised drawing feedback accessible to anyone who wants to learn.",
    {
      fontFace: FONT,
      fontSize: 13,
      color: C.ink,
      x: 6.4,
      y: 5.74,
      w: CONTENT_W - 5.55,
      h: 0.92,
      valign: "middle",
      lineSpacingMultiple: 1.2,
    },
  );

  // Closing band. Drawn last so it sits over the standard footer.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 6.85,
    w: 13.333,
    h: 0.65,
    fill: { color: C.dark },
    line: { color: C.dark, width: 1 },
  });
  slide.addText(
    [
      { text: "DON'T LET AI DRAW FOR YOU.  ", options: { color: C.mutedInverse } },
      { text: "LET IT TEACH YOU HOW TO DRAW.", options: { color: C.inkInverse } },
    ],
    {
      fontFace: FONT,
      fontSize: 14,
      bold: true,
      charSpacing: 1.6,
      x: M.left,
      y: 6.85,
      w: CONTENT_W,
      h: 0.65,
      align: "center",
      valign: "middle",
    },
  );
}

// ---------------------------------------------------------------------------
// BACKUP 1 — Detailed technical architecture
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `Backup slide. The pipeline in three bands.

Capture: the canvas engine — which exists — plus an event and stroke logger that records how the drawing was constructed, not only the result.

Understand: feature extraction splitting into a geometry engine for perspective and proportion, a vision model for the rendered image, and stroke-behaviour features from the telemetry. Those merge in a multimodal context builder.

Teach: learner state, pedagogical reasoning, a feedback policy that decides what is worth saying, and finally canvas annotation and exercise generation.

Only the canvas engine is built today. Everything after it is the TRL 3 to 4 programme.`,
  });
  header(slide, "Backup A", "Detailed technical architecture.");

  /** Draws one horizontal chain of nodes filling the content width. */
  function chain(nodes, { y, height, builtIndex = -1, x = M.left, width = CONTENT_W, gap = 0.22 }) {
    const nodeW = (width - (nodes.length - 1) * gap) / nodes.length;
    nodes.forEach((node, index) => {
      const nx = x + index * (nodeW + gap);
      const built = index === builtIndex;
      card(slide, {
        x: nx,
        y,
        w: nodeW,
        h: height,
        fill: built ? C.accentSoft : C.surface,
        line: built ? C.accent : C.border,
      });
      slide.addText(node, {
        ...T.body,
        fontSize: 10,
        bold: built,
        color: built ? C.accentDeep : C.ink,
        x: nx + 0.08,
        y,
        w: nodeW - 0.16,
        h: height,
        align: "center",
        valign: "middle",
        lineSpacingMultiple: 1.1,
      });
      if (built) {
        chip(slide, {
          x: nx + nodeW - 1.28,
          y: y + height / 2 - 0.12,
          w: 1.15,
          h: 0.24,
          text: "BUILT TODAY",
          fill: C.accent,
          color: "FFFFFF",
        });
      }
      if (index < nodes.length - 1) {
        arrow(slide, {
          x: nx + nodeW + 0.03,
          y: y + height / 2,
          w: gap - 0.06,
          h: 0,
          color: C.borderStrong,
        });
      }
    });
  }

  function bandLabel(text, y) {
    slide.addText(text, { ...T.label, color: C.accent, x: M.left, y, w: 2.4, h: 0.2 });
  }

  bandLabel("CAPTURE", 1.72);
  chain(["Canvas Engine", "Event / Stroke Logger"], { y: 1.98, height: 0.72, builtIndex: 0 });
  arrow(slide, { x: 6.66, y: 2.78, w: 0, h: 0.28, color: C.accent });

  // Feature extraction fans out into three parallel analysers before the three
  // signals are merged, so this band is not a single chain.
  bandLabel("UNDERSTAND", 3.14);
  const feW = 3.0;
  const brW = 4.0;
  const cbX = M.left + feW + 0.4 + brW + 0.4;
  const cbW = CONTENT_W - feW - brW - 0.8;
  card(slide, { x: M.left, y: 3.4, w: feW, h: 1.14, fill: C.surface, line: C.border });
  slide.addText("Feature Extraction", {
    ...T.body,
    fontSize: 10,
    x: M.left + 0.08,
    y: 3.4,
    w: feW - 0.16,
    h: 1.14,
    align: "center",
    valign: "middle",
  });
  const branches = ["Geometry Engine", "Vision Model", "Stroke Behaviour Features"];
  branches.forEach((branch, index) => {
    const by = 3.4 + index * 0.41;
    card(slide, { x: M.left + feW + 0.4, y: by, w: brW, h: 0.32, fill: C.surface, line: C.border });
    slide.addText(branch, {
      ...T.body,
      fontSize: 9.5,
      x: M.left + feW + 0.44,
      y: by,
      w: brW - 0.08,
      h: 0.32,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    arrow(slide, {
      x: M.left + feW + 0.06,
      y: by + 0.16,
      w: 0.28,
      h: 0,
      color: C.borderStrong,
    });
    arrow(slide, { x: cbX - 0.34, y: by + 0.16, w: 0.28, h: 0, color: C.borderStrong });
  });
  card(slide, { x: cbX, y: 3.4, w: cbW, h: 1.14, fill: C.surface, line: C.border });
  slide.addText("Multimodal Context Builder", {
    ...T.body,
    fontSize: 10,
    x: cbX + 0.08,
    y: 3.4,
    w: cbW - 0.16,
    h: 1.14,
    align: "center",
    valign: "middle",
    lineSpacingMultiple: 1.1,
  });
  arrow(slide, { x: 6.66, y: 4.62, w: 0, h: 0.28, color: C.accent });

  bandLabel("TEACH", 4.98);
  chain(
    [
      "Learner State",
      "Pedagogical Reasoning",
      "Feedback Policy",
      "Canvas Annotation / Exercise Generator",
    ],
    { y: 5.24, height: 0.72 },
  );

  slide.addText(
    "Only the canvas engine exists today. Everything downstream of it is the work GENESIS EIR would fund, and the reason this is a TRL 3 application rather than a TRL 5 one.",
    { ...T.small, x: M.left, y: 6.26, w: CONTENT_W, h: 0.3 },
  );
}

// ---------------------------------------------------------------------------
// BACKUP 2 — Validation hypotheses & metrics
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `Backup slide. What we actually need to prove, and how we would measure it.

Four hypotheses: can Folio reliably identify specific beginner sketching errors; are AI-generated corrections pedagogically accurate; do learners improve faster with Folio feedback than with self-guided practice alone; and will they come back for it.

The metrics below are what we would instrument during the closed pilot. Diagnostic precision and feedback acceptance test whether the system is right. Completion, repeat attempts and improvement between attempts test whether it teaches. Retention and satisfaction test whether it is worth using.`,
  });
  header(slide, "Backup B", "What we need to validate.");

  const hypotheses = [
    ["H1", "Can Folio reliably identify specific beginner sketching errors?", "Diagnostic capability"],
    ["H2", "Can AI-generated corrections be pedagogically accurate?", "Teaching quality"],
    [
      "H3",
      "Do learners improve faster with repeated Folio feedback than with self-guided practice alone?",
      "Learning effect",
    ],
    ["H4", "Will learners repeatedly return for feedback?", "Retention"],
  ];
  const hw = (CONTENT_W - 0.28) / 2;
  hypotheses.forEach((item, index) => {
    const x = M.left + (index % 2) * (hw + 0.28);
    const y = 1.78 + Math.floor(index / 2) * 1.3;
    card(slide, { x, y, w: hw, h: 1.12, fill: C.surface, line: C.border });
    slide.addText(item[0], {
      fontFace: FONT,
      fontSize: 20,
      bold: true,
      color: C.accentSoft,
      x: x + 0.26,
      y: y + 0.16,
      w: 0.8,
      h: 0.36,
    });
    slide.addText(item[2].toUpperCase(), {
      ...T.label,
      fontSize: 8,
      color: C.accent,
      x: x + 1.1,
      y: y + 0.26,
      w: hw - 1.36,
      h: 0.2,
    });
    slide.addText(item[1], {
      ...T.body,
      fontSize: 11.5,
      x: x + 0.26,
      y: y + 0.58,
      w: hw - 0.52,
      h: 0.56,
      valign: "top",
      lineSpacingMultiple: 1.15,
    });
  });

  slide.addText("PILOT METRICS", { ...T.label, color: C.ink, x: M.left, y: 4.5, w: 4, h: 0.22 });
  const metrics = [
    ["Diagnostic precision", "Are detected errors real errors?"],
    ["Feedback acceptance", "Does the learner agree with the critique?"],
    ["Exercise completion", "Do learners finish what is recommended?"],
    ["Repeat attempts", "Do they retry after a correction?"],
    ["Improvement between attempts", "Measurable change across retries."],
    ["Weekly retention", "Do they come back without prompting?"],
    ["Learner satisfaction", "Would they recommend it?"],
  ];
  const mcw2 = (CONTENT_W - 3 * 0.16) / 4;
  metrics.forEach((metric, index) => {
    const x = M.left + (index % 4) * (mcw2 + 0.16);
    const y = 4.82 + Math.floor(index / 4) * 0.92;
    card(slide, { x, y, w: mcw2, h: 0.78, fill: C.accentSofter, line: C.accentSoft });
    slide.addText(metric[0], {
      ...T.body,
      fontSize: 10,
      bold: true,
      color: C.accentDeep,
      x: x + 0.18,
      y: y + 0.12,
      w: mcw2 - 0.36,
      h: 0.3,
      valign: "top",
      lineSpacingMultiple: 1.05,
    });
    slide.addText(metric[1], {
      ...T.micro,
      x: x + 0.18,
      y: y + 0.44,
      w: mcw2 - 0.36,
      h: 0.28,
      lineSpacingMultiple: 1.1,
    });
  });
}

// ---------------------------------------------------------------------------
// BACKUP 3 — Expansion roadmap
// ---------------------------------------------------------------------------
{
  const slide = newSlide({
    notes: `Backup slide. Where this goes if the core loop works.

We start narrow, on foundational sketching, because that is where the error patterns are most common and most teachable, and where we can measure improvement fastest.

From there the same machinery extends to perspective, form, object drawing, anatomy, portrait construction, environments, architectural sketching and industrial or product sketching. Each is a new curriculum and a new set of analysers on the same pipeline.

Longer term, nothing about the architecture is specific to drawing. A system that observes a process, diagnoses it and teaches it is a general engine for learning visual skills.`,
  });
  header(slide, "Backup C", "Expansion roadmap.");

  const zones = [
    {
      label: "START",
      title: "Foundational sketching",
      body: "The narrowest domain where improvement is measurable, and where beginner errors repeat most predictably.",
      items: ["Line control", "Construction", "Basic form", "Proportion"],
      accent: true,
    },
    {
      label: "EXPANSION",
      title: "Adjacent drawing domains",
      body: "Each is a new curriculum and new analysers on the same pipeline.",
      items: [
        "Perspective",
        "Form",
        "Object drawing",
        "Anatomy",
        "Portrait construction",
        "Environments",
        "Architecture sketching",
        "Industrial / product sketching",
      ],
      accent: false,
    },
    {
      label: "LONG TERM",
      title: "A general engine for learning visual skills",
      body: "Observe a process, diagnose it, teach it.",
      items: [
        "Not drawing-specific by design",
        "New domains = new analysers",
        "Learner model is the durable asset",
      ],
      accent: false,
      dash: true,
    },
  ];
  const zw = (CONTENT_W - 0.56) / 3;
  zones.forEach((zone, index) => {
    const x = M.left + index * (zw + 0.28);
    card(slide, {
      x,
      y: 1.82,
      w: zw,
      h: 4.0,
      fill: zone.accent ? C.accentSofter : C.surface,
      line: zone.accent ? C.accent : C.border,
      dash: zone.dash ? "dash" : undefined,
    });
    slide.addText(zone.label, {
      ...T.label,
      color: zone.accent ? C.accent : C.faint,
      x: x + 0.28,
      y: 2.06,
      w: zw - 0.56,
      h: 0.2,
    });
    slide.addText(zone.title, {
      ...T.body,
      fontSize: 15,
      bold: true,
      color: zone.accent ? C.accentDeep : C.ink,
      x: x + 0.28,
      y: 2.34,
      w: zw - 0.56,
      h: 0.72,
      valign: "top",
      lineSpacingMultiple: 1.1,
    });
    slide.addText(zone.body, {
      ...T.small,
      fontSize: 10,
      x: x + 0.28,
      y: 3.1,
      w: zw - 0.56,
      h: 0.7,
      valign: "top",
      lineSpacingMultiple: 1.2,
    });
    zone.items.forEach((item, itemIndex) => {
      const y = 3.82 + itemIndex * 0.245;
      dot(slide, { x: x + 0.3, y: y + 0.06, size: 0.07, color: C.accent });
      slide.addText(item, {
        ...T.body,
        fontSize: 10,
        x: x + 0.5,
        y,
        w: zw - 0.78,
        h: 0.24,
        valign: "middle",
      });
    });
    if (index < zones.length - 1) {
      arrow(slide, { x: x + zw + 0.06, y: 3.87, w: 0.16, h: 0, color: C.accent });
    }
  });

  slide.addText(
    "Expansion is sequenced by measurable teaching quality, not by breadth. A domain only ships when Folio can diagnose it reliably.",
    { ...T.small, x: M.left, y: 6.1, w: CONTENT_W, h: 0.3 },
  );
}

// ---------------------------------------------------------------------------

await pptx.writeFile({ fileName: OUTPUT });
console.log(`Wrote ${OUTPUT}`);
console.log(`Slides: ${slideNumber} (11 main + 3 backup) · font: ${FONT}`);
