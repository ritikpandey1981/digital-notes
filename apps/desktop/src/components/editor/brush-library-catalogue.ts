import { DEFAULT_BRUSH_PRESETS, type DrawingToolKind } from "@folio/editor";

/**
 * The provisional Brush Library catalogue.
 *
 * These are real, selectable editor brush *identities*: stable ids, stable
 * names, stable order, and a deterministic mapping onto the presets the engine
 * genuinely renders today. Assigning one to a dock slot changes what the next
 * stroke looks like, and the slot remembers which identity it holds.
 *
 * What they are NOT, and must not be presented as, is forty-five distinct brush
 * engines. The renderer has exactly two behaviours — a constant-width
 * centreline and a pressure-varying outline — and every identity here resolves
 * onto one of the nine real pencil/pen/marker presets through
 * `fallbackPresetId`. Two identities sharing a fallback draw identically today.
 *
 * That gap is deliberate and is the point of the split: identity is recorded in
 * editor state, backing is a lookup. When the dedicated brush-engine phase adds
 * real per-brush behaviour, only the mapping moves — every slot keeps the
 * identity the artist chose, and no saved state has to be migrated.
 *
 * The families are limited to pencil, pen and marker precisely because those
 * are the ones the engine has presets for. Nothing here names a watercolour, a
 * pastel, a chalk or an airbrush: those belong to the later phase, and putting
 * them in the wheel now would promise texture the engine cannot draw.
 */

/** The families this phase can honestly back. Highlighter has no entries yet. */
export type BrushLibraryFamily = Extract<DrawingToolKind, "pencil" | "pen" | "marker">;

export interface BrushLibraryEntry {
  /** Permanent identity. Written into slot state and never regenerated. */
  readonly id: string;
  readonly name: string;
  readonly family: BrushLibraryFamily;
  /**
   * The real catalogue preset that renders this identity today.
   *
   * Provisional by design: several identities share one preset, and swapping a
   * mapping later changes how a brush draws without changing which brush a slot
   * holds.
   */
  readonly fallbackPresetId: string;
}

function entry(
  id: string,
  name: string,
  family: BrushLibraryFamily,
  fallbackPresetId: string,
): BrushLibraryEntry {
  return Object.freeze({ id, name, family, fallbackPresetId });
}

/**
 * One curated, fixed sequence of forty-five identities.
 *
 * The order is authored, never generated: the same brush occupies the same cell
 * on every launch, so muscle memory works and tests can name a cell.
 *
 * Families are deliberately interleaved rather than run in blocks. The rings
 * fill straight down this list, and a strict pencils-then-pens-then-markers
 * order would hand ring 1 to the pencils outright — the wheel would read as a
 * taxonomy diagram instead of one instrument. Every ring gets all three.
 */
export const BRUSH_LIBRARY_CATALOGUE: readonly BrushLibraryEntry[] = Object.freeze([
  // Ring 1 — cells 1..10
  entry("hb-pencil", "HB Pencil", "pencil", "pencil-hb"),
  entry("fineliner", "Fineliner", "pen", "pen-fineliner"),
  entry("soft-pencil", "Soft Pencil", "pencil", "pencil-2b"),
  entry("fine-marker", "Fine Marker", "marker", "marker-felt"),
  entry("gel-pen", "Gel Pen", "pen", "pen-fineliner"),
  entry("mechanical-pencil", "Mechanical Pencil", "pencil", "pencil-mechanical"),
  entry("technical-pen", "Technical Pen", "pen", "pen-technical"),
  entry("felt-marker", "Felt Marker", "marker", "marker-felt"),
  entry("2b-pencil", "2B Pencil", "pencil", "pencil-2b"),
  entry("brush-pen-soft", "Brush Pen Soft", "pen", "pen-brush"),
  // Ring 2 — cells 11..23
  entry("hard-pencil", "Hard Pencil", "pencil", "pencil-hb"),
  entry("ballpoint", "Ballpoint", "pen", "pen-fineliner"),
  entry("broad-marker", "Broad Marker", "marker", "marker-broad"),
  entry("4b-pencil", "4B Pencil", "pencil", "pencil-4b"),
  entry("brush-pen-firm", "Brush Pen Firm", "pen", "pen-brush"),
  entry("sketch-pencil", "Sketch Pencil", "pencil", "pencil-2b"),
  entry("chisel-marker", "Chisel Marker", "marker", "marker-broad"),
  entry("rollerball", "Rollerball", "pen", "pen-fineliner"),
  entry("layout-pencil", "Layout Pencil", "pencil", "pencil-hb"),
  entry("fountain-pen", "Fountain Pen", "pen", "pen-brush"),
  entry("bullet-marker", "Bullet Marker", "marker", "marker-felt"),
  entry("6b-pencil", "6B Pencil", "pencil", "pencil-4b"),
  entry("micro-liner", "Micro Liner", "pen", "pen-technical"),
  // Ring 3 — cells 24..38
  entry("draughting-pencil", "Draughting Pencil", "pencil", "pencil-mechanical"),
  entry("calligraphy-pen", "Calligraphy Pen", "pen", "pen-brush"),
  entry("sketch-marker", "Sketch Marker", "marker", "marker-felt"),
  entry("shading-pencil", "Shading Pencil", "pencil", "pencil-4b"),
  entry("drafting-pen", "Drafting Pen", "pen", "pen-technical"),
  entry("fine-lead", "Fine Lead", "pencil", "pencil-mechanical"),
  entry("wide-marker", "Wide Marker", "marker", "marker-broad"),
  entry("bold-liner", "Bold Liner", "pen", "pen-fineliner"),
  entry("contour-pencil", "Contour Pencil", "pencil", "pencil-2b"),
  entry("ink-pen", "Ink Pen", "pen", "pen-fineliner"),
  entry("studio-marker", "Studio Marker", "marker", "marker-broad"),
  entry("broad-lead", "Broad Lead", "pencil", "pencil-4b"),
  entry("sign-pen", "Sign Pen", "pen", "pen-brush"),
  entry("layout-marker", "Layout Marker", "marker", "marker-felt"),
  entry("fine-ink", "Fine Ink", "pen", "pen-technical"),
  // Ring 4 — cells 39..45
  entry("blueline-pencil", "Blueline Pencil", "pencil", "pencil-hb"),
  entry("dynamic-pen", "Dynamic Pen", "pen", "pen-brush"),
  entry("slim-marker", "Slim Marker", "marker", "marker-felt"),
  entry("ruling-pen", "Ruling Pen", "pen", "pen-technical"),
  entry("block-marker", "Block Marker", "marker", "marker-broad"),
  entry("contour-pen", "Contour Pen", "pen", "pen-fineliner"),
  entry("flat-marker", "Flat Marker", "marker", "marker-broad"),
]);

const ENTRIES_BY_ID: ReadonlyMap<string, BrushLibraryEntry> = new Map(
  BRUSH_LIBRARY_CATALOGUE.map((item) => [item.id, item]),
);

export function brushLibraryEntryById(id: string | null): BrushLibraryEntry | null {
  if (id === null) return null;
  return ENTRIES_BY_ID.get(id) ?? null;
}

/**
 * The identity each dock slot starts holding.
 *
 * Chosen so a fresh session presents the same five brushes the dock always
 * has: the entries named here resolve to the presets those slots were already
 * pinned to. The Highlighter slot maps to nothing, because the catalogue has no
 * highlighter identities in this phase — and rather than invent one, the slot
 * simply holds no library identity and the wheel shows nothing selected.
 */
export const DEFAULT_SLOT_BRUSH_IDS: Readonly<Record<string, string | null>> = Object.freeze({
  pencil: "hb-pencil",
  pen: "fineliner",
  "brush-pen": "brush-pen-soft",
  marker: "felt-marker",
  highlighter: null,
});

/** Every preset id the catalogue relies on, for validation against the engine. */
export function referencedFallbackPresetIds(): readonly string[] {
  return Object.freeze([...new Set(BRUSH_LIBRARY_CATALOGUE.map((item) => item.fallbackPresetId))]);
}

/**
 * True when every identity resolves onto a preset the engine actually has.
 *
 * The catalogue is authored by hand, so this is the guard that stops a typo or
 * an invented brush from reaching the wheel claiming backing it does not have.
 */
export function catalogueIsFullyBacked(
  presets: readonly {
    readonly id: string;
    readonly family: DrawingToolKind;
  }[] = DEFAULT_BRUSH_PRESETS,
): boolean {
  return BRUSH_LIBRARY_CATALOGUE.every((item) => {
    const preset = presets.find(({ id }) => id === item.fallbackPresetId);
    return preset !== undefined && preset.family === item.family;
  });
}

/** The assignment payload for one identity, for the slot store. */
export function assignmentForBrush(
  brushId: string,
): { brushId: string; family: BrushLibraryFamily; fallbackPresetId: string } | null {
  const item = brushLibraryEntryById(brushId);
  if (item === null) return null;
  return Object.freeze({
    brushId: item.id,
    family: item.family,
    fallbackPresetId: item.fallbackPresetId,
  });
}
