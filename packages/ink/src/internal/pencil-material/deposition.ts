import type { MaterialFieldTile } from "./fields";
import { clampUnit } from "./material-hash";
import type { MaterialResource } from "./resources";
import { MATERIAL_RESOLUTION, TILE_CELLS, type ActiveMaterialTile } from "./tiles";

/**
 * The hybrid material equation: what one tip placement deposits, and how
 * deposits accumulate on top of one another.
 *
 * This is the single implementation of both. Live accumulation and cold
 * reconstruction call *this* function, not two functions that agree by
 * inspection -- a medium with one algorithm for drawing and another for redraw
 * is a medium that changes under the artist the first time a cache is dropped.
 *
 * The material is a product of four things, and each is doing a job no other
 * can:
 *
 * - **A circular textured nib**, which is why a tap is a tip and not a disc,
 *   and why a terminal runs out instead of being cut off.
 * - **The sheet's tooth, in page space**, which is what pressure *reveals*
 *   rather than replaces.
 * - **A clump field**, because graphite crumbs: neighbouring paper takes it and
 *   leaves it together, and an even stipple reads as spray.
 * - **Pressure-dependent deposition**, which moves the contact threshold and so
 *   changes how much of the same sheet takes graphite.
 *
 * On top of that sits a fine-tip term, which exists for one measured reason: at
 * two to six page units a tip is only a few field cells across, and a model
 * that thresholds tooth alone breaks such a line into a dashed chain. A radial
 * core floor keeps it continuous without erasing the grain around it.
 */

/** One evaluated tip placement, in page units. */
export interface MaterialDab {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** How much of the tip deposits, 0..1. Pressure moves this. */
  readonly coverage: number;
  /** Distance travelled along the path when the tip landed here. */
  readonly arc: number;
}

/** Everything a deposit reads that is the same for every dab of one stroke. */
export interface MaterialDepositionContext {
  readonly nib: MaterialResource;
  /** Base opacity, folded into the deposited bytes exactly once. */
  readonly opacity: number;
  /** Boost for tips too narrow for the tooth lattice to resolve. */
  readonly fineBoost: number;
  /** Nominal advance between dabs, which sets the passage threshold. */
  readonly spacing: number;
}

const CONTACT_LOAD_FLOOR = 0.6;
const CONTACT_LOAD_RANGE = 0.7;
const CLUMP_PIVOT = 0.24;
const CLUMP_SPAN = 0.52;
const CONTACT_TOOTH_WEIGHT = 0.63;
const CONTACT_BIAS = 0.1;
const CONTACT_FINE_BIAS = 0.22;
const CONTACT_SPAN = 0.25;
const TONE_FLOOR = 0.18;
const TONE_RANGE = 0.78;
const TONE_EXPONENT = 1.15;
const TONE_TOOTH_FLOOR = 0.67;
const TONE_TOOTH_RANGE = 0.33;
const SHARPEN_AMOUNT = 0.24;
const SHARPEN_CORE = 0.64;
const SHARPEN_SPAN = 0.3;
const SHARPEN_COVERAGE_FLOOR = 0.7;
const SHARPEN_COVERAGE_RANGE = 0.3;

/**
 * How far past a dab's own advance the tip may travel before a return counts as
 * a new passage rather than as the same one continuing.
 *
 * Consecutive dabs of one pass overlap by construction, so without this every
 * overlap would compound and a straight line would darken with the sampling
 * rate. Above one advance, and not far above: a deliberate retrace has to be
 * able to find its own mark again.
 */
const PASSAGE_ADVANCE_FACTOR = 1.6;
const PASSAGE_EPSILON = 1e-3;

/** Tip width at which a line no longer needs the narrow-tip core floor. */
const FINE_TIP_CEILING = 7;
const FINE_TIP_SPAN = 5;

/** The nib mask is square and power-of-two, so its half and its last index. */
const NIB_HALF = 64;
const NIB_EDGE = 127;
const NIB_STRIDE = 128;

export function fineTipBoost(brushSize: number): number {
  return clampUnit((FINE_TIP_CEILING - brushSize) / FINE_TIP_SPAN);
}

/**
 * Per-byte coefficient tables, built once for the process.
 *
 * The fields arrive quantized to bytes, so every term depending only on a field
 * value has 256 possible results. Precomputing them takes a `pow` out of the
 * innermost loop of the whole engine without changing a bit: each entry is the
 * exact expression it replaces, evaluated in the same order. The tonal term
 * factors into one coefficient per field, which is why there are three tables
 * of 256 rather than one of 65 536.
 */
const clumpLoad = new Float64Array(256);
const toneFromClump = new Float64Array(256);
const toneFromTooth = new Float64Array(256);
for (let byte = 0; byte < 256; byte += 1) {
  const clump = clampUnit((byte / 255 - CLUMP_PIVOT) / CLUMP_SPAN);
  clumpLoad[byte] = CONTACT_LOAD_FLOOR + CONTACT_LOAD_RANGE * clump;
  toneFromClump[byte] = TONE_FLOOR + TONE_RANGE * Math.pow(clump, TONE_EXPONENT);
  toneFromTooth[byte] = TONE_TOOTH_FLOOR + TONE_TOOTH_RANGE * (1 - byte / 255);
}

/** The clipped cell rectangle one dab covers inside one tile, inclusive. */
export interface DabTileSupport {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function dabTileSupport(dab: MaterialDab, tx: number, ty: number): DabTileSupport {
  const reach = dab.radius * MATERIAL_RESOLUTION;
  const centerX = dab.x * MATERIAL_RESOLUTION;
  const centerY = dab.y * MATERIAL_RESOLUTION;
  const originX = tx * TILE_CELLS;
  const originY = ty * TILE_CELLS;
  return {
    x0: Math.max(0, Math.floor(centerX - reach) - originX),
    y0: Math.max(0, Math.floor(centerY - reach) - originY),
    x1: Math.min(TILE_CELLS - 1, Math.ceil(centerX + reach) - originX),
    y1: Math.min(TILE_CELLS - 1, Math.ceil(centerY + reach) - originY),
  };
}

/**
 * Every tile one dab reaches into, appended as `tx, ty` pairs.
 *
 * Flat pairs into a caller-owned array rather than objects, because this runs
 * once per dab and a long stroke places tens of thousands of them.
 */
export function collectDabTiles(dab: MaterialDab, into: number[]): number[] {
  into.length = 0;
  const reach = dab.radius * MATERIAL_RESOLUTION;
  const centerX = dab.x * MATERIAL_RESOLUTION;
  const centerY = dab.y * MATERIAL_RESOLUTION;
  const minimumX = Math.floor((centerX - reach) / TILE_CELLS);
  const maximumX = Math.floor((centerX + reach) / TILE_CELLS);
  const minimumY = Math.floor((centerY - reach) / TILE_CELLS);
  const maximumY = Math.floor((centerY + reach) / TILE_CELLS);
  for (let ty = minimumY; ty <= maximumY; ty += 1) {
    for (let tx = minimumX; tx <= maximumX; tx += 1) into.push(tx, ty);
  }
  return into;
}

/**
 * Deposits one dab into one tile.
 *
 * Evaluation and accumulation happen in one pass over the dab's support.
 * Nothing here reads a neighbouring cell, so the two are independent per cell:
 * running them together is the same arithmetic in the same order with one fewer
 * traversal and no tile-sized scratch buffer.
 *
 * The accumulation rule is the second half of the material, and the one that
 * decides whether a stroke reads as graphite or as paint:
 *
 * - Within one passage a cell keeps the **strongest** contact, so the dozens of
 *   overlapping dabs that make up one pass deposit once rather than dozens of
 *   times, and the mark is the same at 60 samples a second as at 240.
 * - A tip that leaves a cell and comes back later starts a **new passage**,
 *   whose deposit composites over what the last one left. That is what makes a
 *   deliberate retrace darken -- which is how graphite actually builds -- while
 *   a single pass saturates instead of compounding without limit.
 */
export function depositDab(
  tile: ActiveMaterialTile,
  dab: MaterialDab,
  fields: MaterialFieldTile,
  support: DabTileSupport,
  context: MaterialDepositionContext,
): void {
  const reach = dab.radius * MATERIAL_RESOLUTION;
  const centerX = dab.x * MATERIAL_RESOLUTION;
  const centerY = dab.y * MATERIAL_RESOLUTION;
  const originX = tile.tx * TILE_CELLS;
  const originY = tile.ty * TILE_CELLS;
  const nib = context.nib.samples;
  const fineBoost = context.fineBoost;
  const contactBias = CONTACT_BIAS + fineBoost * CONTACT_FINE_BIAS;
  const sharpenScale =
    fineBoost * SHARPEN_AMOUNT * (SHARPEN_COVERAGE_FLOOR + SHARPEN_COVERAGE_RANGE * dab.coverage);
  const scale = 255 * context.opacity;
  const passageLimit = context.spacing * PASSAGE_ADVANCE_FACTOR + PASSAGE_EPSILON;
  const arc = dab.arc;

  for (let y = support.y0; y <= support.y1; y += 1) {
    const row = y * TILE_CELLS;
    const unitY = (y + originY + 0.5 - centerY) / reach;
    for (let x = support.x0; x <= support.x1; x += 1) {
      const unitX = (x + originX + 0.5 - centerX) / reach;
      const radial = unitX * unitX + unitY * unitY;
      if (radial >= 1) continue;
      const cell = row + x;
      const nibX = clampNibIndex(Math.floor((unitX + 1) * NIB_HALF));
      const nibY = clampNibIndex(Math.floor((unitY + 1) * NIB_HALF));
      const mask = (nib[nibY * NIB_STRIDE + nibX] ?? 0) / 255;
      const toothByte = fields.tooth[cell] ?? 0;
      const clumpByte = fields.clump[cell] ?? 0;
      const tooth = toothByte / 255;
      const load = dab.coverage * (clumpLoad[clumpByte] ?? 0);
      const contact = clampUnit(
        (load * mask - tooth * CONTACT_TOOTH_WEIGHT + contactBias) / CONTACT_SPAN,
      );
      const tone = (toneFromClump[clumpByte] ?? 0) * (toneFromTooth[toothByte] ?? 0);
      const sharpened = sharpenScale * clampUnit((SHARPEN_CORE - radial) / SHARPEN_SPAN);
      const deposited = mask * Math.max(contact * tone, sharpened);
      const value = Math.round(scale * clampUnit(deposited));

      if (arc - (tile.last[cell] ?? 0) > passageLimit) {
        tile.base[cell] = tile.alpha[cell] ?? 0;
        tile.peak[cell] = 0;
      }
      tile.last[cell] = arc;
      if (value > (tile.peak[cell] ?? 0)) {
        tile.peak[cell] = value;
        const base = tile.base[cell] ?? 0;
        tile.alpha[cell] = Math.round(base + ((255 - base) * value) / 255);
      }
    }
  }
}

function clampNibIndex(value: number): number {
  return value < 0 ? 0 : value > NIB_EDGE ? NIB_EDGE : value;
}
