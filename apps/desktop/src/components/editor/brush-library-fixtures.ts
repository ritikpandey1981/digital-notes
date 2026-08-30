/**
 * Dummy brush catalogue for radial Brush Library layout evaluation.
 *
 * THIS IS UI FIXTURE DATA. None of these entries is a real brush: they are not
 * registered with the brush store, they cannot be selected into a preset, and
 * several of them name behaviour the engine does not have (watercolour, chalk,
 * grain). They exist only to fill the radial tracks so the geometry can be
 * judged with a realistic item count.
 *
 * `docs/design/drawing-tool-system.md` §26 records which of these are genuinely
 * supported today and which remain PLACEHOLDER CAPABILITY. Wiring real
 * selection is a later task; §25 of that document governs what may ever ship.
 */

/** Library grouping, recorded for ordering only — it never picks a track. */
export type BrushFixtureFamily = "pencil" | "pen" | "color-brush";

export interface BrushFixture {
  readonly id: string;
  readonly name: string;
  readonly family: BrushFixtureFamily;
}

function fixture(id: string, name: string, family: BrushFixtureFamily): BrushFixture {
  return Object.freeze({ id, name, family });
}

/**
 * One continuous ordered sequence: pencils, then pens, then colour brushes.
 *
 * Tracks are filled straight down this list, so a family transition lands
 * wherever it lands — halfway through a track is expected and correct. The
 * radial geometry is deliberately independent of the taxonomy.
 */
export const BRUSH_LIBRARY_FIXTURES: readonly BrushFixture[] = Object.freeze([
  // Pencils — 1..8
  fixture("hard-pencil", "Hard Pencil", "pencil"),
  fixture("soft-pencil", "Soft Pencil", "pencil"),
  fixture("hb", "HB", "pencil"),
  fixture("2b", "2B", "pencil"),
  fixture("4b", "4B", "pencil"),
  fixture("6b", "6B", "pencil"),
  fixture("charcoal", "Charcoal", "pencil"),
  fixture("mechanical-pencil", "Mechanical Pencil", "pencil"),
  // Pens — 9..23
  fixture("fountain-pen", "Fountain Pen", "pen"),
  fixture("dynamic-pen", "Dynamic Pen", "pen"),
  fixture("fineliner", "Fineliner", "pen"),
  fixture("technical-pen", "Technical Pen", "pen"),
  fixture("fixed-width-pen", "Fixed Width Pen", "pen"),
  fixture("marker", "Marker", "pen"),
  fixture("highlighter", "Highlighter", "pen"),
  fixture("brush-pen", "Brush Pen", "pen"),
  fixture("dry-ink", "Dry Ink", "pen"),
  fixture("calligraphy", "Calligraphy", "pen"),
  fixture("technical-bold", "Technical Bold", "pen"),
  fixture("fine-ink", "Fine Ink", "pen"),
  fixture("felt-pen", "Felt Pen", "pen"),
  fixture("ruling-pen", "Ruling Pen", "pen"),
  fixture("reed-pen", "Reed Pen", "pen"),
  // Colour brushes — 24..45
  fixture("airbrush", "Airbrush", "color-brush"),
  fixture("watercolor", "Watercolor", "color-brush"),
  fixture("gouache", "Gouache", "color-brush"),
  fixture("wet-paint", "Wet Paint", "color-brush"),
  fixture("soft-paint", "Soft Paint", "color-brush"),
  fixture("texture-brush", "Texture Brush", "color-brush"),
  fixture("dry-paint", "Dry Paint", "color-brush"),
  fixture("wash", "Wash", "color-brush"),
  fixture("chalk-brush", "Chalk Brush", "color-brush"),
  fixture("pastel", "Pastel", "color-brush"),
  fixture("opaque-paint", "Opaque Paint", "color-brush"),
  fixture("grain-brush", "Grain Brush", "color-brush"),
  fixture("soft-blend", "Soft Blend", "color-brush"),
  fixture("wet-edge", "Wet Edge", "color-brush"),
  fixture("paint-marker", "Paint Marker", "color-brush"),
  fixture("ink-wash", "Ink Wash", "color-brush"),
  fixture("broad-wash", "Broad Wash", "color-brush"),
  fixture("dry-gouache", "Dry Gouache", "color-brush"),
  fixture("grain-wash", "Grain Wash", "color-brush"),
  fixture("soft-pastel-brush", "Soft Pastel Brush", "color-brush"),
  fixture("flat-wash", "Flat Wash", "color-brush"),
  fixture("stipple-brush", "Stipple Brush", "color-brush"),
]);
