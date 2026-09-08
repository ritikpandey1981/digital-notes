import { resolveLayerDropIndex } from "./layers-panel-model";
import {
  projectSheetCorner,
  type SpatialStackLayout,
  type SpatialStackPlane,
} from "./spatial-layer-stack-model";

/**
 * Where a dragged sheet would land, and how the others make room for it.
 *
 * Pure geometry over the frozen stack layout: no DOM, no document, no state.
 * The component owns the gesture; this module answers the two questions that
 * decide what the gesture means, so both can be reasoned about without a
 * window.
 *
 * The canonical move itself is not computed here. `resolveLayerDragMove` in
 * the list model already converts a display-order drag into a storage index,
 * and there is exactly one such mapping in Folio -- the stack reuses it rather
 * than mirroring indexes a second time and risking the two disagreeing.
 */

/** Lift given to the held sheet, in the same depth units the layout uses. */
export const REORDER_LIFT_DEPTH = 26;

/**
 * A sheet's projected lower edge, measured in the bounds' own coordinates.
 *
 * The same projection the focus shelf and the labels use, so "where the sheet
 * is" has one definition. `translateZ` magnifies a plane and `rotateX`
 * foreshortens it by different amounts at every depth, which is why a plane's
 * box is not where it appears.
 */
export function sheetAnchorY(
  layout: SpatialStackLayout,
  plane: SpatialStackPlane,
  tiltDegrees: number,
  offset: number,
): number {
  return (
    plane.translateY +
    layout.planeHeight / 2 +
    projectSheetCorner(layout, plane, tiltDegrees).y -
    offset
  );
}

/**
 * The bands a pointer is tested against, one per sheet in display order.
 *
 * Each band ends at its sheet's projected edge and is one gap tall, so the
 * boundary between two bands sits halfway between two sheets -- which is
 * exactly where "above this one" becomes "below it". Expressed as `top` and
 * `height` so the list's own drop resolver can be reused unchanged.
 */
export function sheetDropBands(
  layout: SpatialStackLayout,
  planes: readonly SpatialStackPlane[],
  tiltDegrees: number,
  offset: number,
): readonly Readonly<{ top: number; height: number }>[] {
  const height = Math.max(1, layout.gap);
  return planes.map((plane) => ({
    top: sheetAnchorY(layout, plane, tiltDegrees, offset) - height,
    height,
  }));
}

/**
 * The insertion gap a pointer is currently over, in display order.
 *
 * 0 is above the topmost sheet and `planes.length` is below the bottom one,
 * which is what a position *between* two sheets actually means. Paper is never
 * a candidate: it is Page state and is not passed in.
 */
export function resolveSpatialDropIndex(
  pointerY: number,
  layout: SpatialStackLayout,
  planes: readonly SpatialStackPlane[],
  tiltDegrees: number,
  offset: number,
): number {
  if (planes.length === 0) return 0;
  if (!Number.isFinite(pointerY)) return 0;
  return resolveLayerDropIndex(pointerY, sheetDropBands(layout, planes, tiltDegrees, offset));
}

/**
 * The display slot each sheet occupies while a drag is in flight.
 *
 * Presentation only. The document is untouched until the drop, so this is what
 * lets the neighbours open a space without five commands being executed on the
 * way past five layers.
 *
 * The dragged sheet keeps its own entry -- it is following the pointer and does
 * not sit in a slot -- and every other sheet closes up behind it and reopens
 * ahead of it, which is what reads as one sheet being lifted out and put back.
 */
export function resolveReorderSlots(
  layerCount: number,
  fromDisplayIndex: number,
  insertDisplayIndex: number,
): readonly number[] {
  const count = Math.max(0, Math.floor(layerCount));
  if (count === 0) return Object.freeze([]);
  const from = clampIndex(fromDisplayIndex, count - 1);
  const insert = clampIndex(insertDisplayIndex, count);
  // Removing the dragged sheet first shifts every later gap up by one, the same
  // adjustment the list makes before converting to a storage index.
  const settled = insert > from ? insert - 1 : insert;
  const slots: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index === from) {
      slots.push(settled);
      continue;
    }
    // Where this sheet sits once the dragged one has been taken out...
    const withoutDragged = index > from ? index - 1 : index;
    // ...and where it ends up once the dragged one is put back in.
    slots.push(withoutDragged >= settled ? withoutDragged + 1 : withoutDragged);
  }
  return Object.freeze(slots);
}

/** True when the gesture would leave canonical order exactly as it was. */
export function isNoOpReorder(
  layerCount: number,
  fromDisplayIndex: number,
  insertDisplayIndex: number,
): boolean {
  const count = Math.max(0, Math.floor(layerCount));
  if (count < 2) return true;
  const from = clampIndex(fromDisplayIndex, count - 1);
  const insert = clampIndex(insertDisplayIndex, count);
  return (insert > from ? insert - 1 : insert) === from;
}

/**
 * Whether a sheet may be dragged at all.
 *
 * A single-layer document has nowhere to move to. Hidden, locked and empty
 * layers are all reorderable: lock governs artwork editing, not where the sheet
 * sits in the stack, and that is the rule the list already follows.
 */
export function canReorderLayers(layerCount: number): boolean {
  return layerCount > 1;
}

function clampIndex(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), Math.max(0, maximum));
}

/**
 * Edge-dwell auto-navigation, for reaching destinations the window cannot show.
 *
 * The focused sheet is held on a shelf near the bottom of the workspace and the
 * sheets are a full gap apart, so at any supported window size the insertion
 * point *below* the held sheet is off-screen: raw pointer travel simply cannot
 * express every valid destination. Holding near a structural edge slides the
 * arrangement under the held sheet instead, one layer at a time.
 *
 * This is transient presentation. It never changes which layer is active, never
 * touches the document, and disappears with the gesture.
 */
export const REORDER_EDGE = Object.freeze({
  /**
   * Depth of the edge zone, measured inside the usable band.
   *
   * Roughly a control cluster tall: deep enough to hold without precision, and
   * shallow enough that the middle of the workspace stays ordinary space where
   * the pointer chooses between the destinations already on screen.
   */
  zoneSize: 72,
  /**
   * Deliberate hold before the first step.
   *
   * Compared 250 / 350 / 450 in the real window against a five-layer document.
   * 250 fires while the hand is still travelling toward a visible destination,
   * which moves the stack when the artist meant to aim. 450 reads as an
   * unresponsive edge and invites a second, harder push. 350 is long enough to
   * be a decision and short enough not to feel stuck.
   */
  firstDwellMs: 350,
  /**
   * Cadence for continued holding.
   *
   * Slightly longer than the neighbour transition, so each step is legible as
   * one layer arriving before the next begins. Traversing ten layers in one
   * gesture is possible; flying through them is not.
   */
  repeatMs: 380,
});

export type ReorderEdge = "up" | "down" | null;

/**
 * Which structural edge the pointer is in, if any.
 *
 * Measured against the usable band the sheets are laid out in rather than the
 * window, so the zones never sit under the dock, the property rail or the
 * utility rail. Pure and total: a degenerate or hostile band yields no edge
 * rather than an accidental one.
 */
export function resolveReorderEdgeZone(
  pointerY: number,
  usableTop: number,
  usableBottom: number,
  zoneSize: number = REORDER_EDGE.zoneSize,
): ReorderEdge {
  if (!Number.isFinite(pointerY) || !Number.isFinite(usableTop) || !Number.isFinite(usableBottom)) {
    return null;
  }
  const height = usableBottom - usableTop;
  if (height <= 0 || zoneSize <= 0) return null;
  // A band too short for two zones plus neutral space in between would make the
  // whole workspace an edge, so it keeps none.
  const zone = Math.min(zoneSize, height / 3);
  if (pointerY <= usableTop + zone) return "up";
  if (pointerY >= usableBottom - zone) return "down";
  return null;
}

/**
 * How far the arrangement may be slid under the held sheet, in whole layers.
 *
 * Bounded by the arrangement itself: exposure that brings the focus position to
 * the top sheet or the bottom sheet is as far as there is to go. Clamping here
 * is what makes holding at an edge at the end of the stack do nothing at all,
 * rather than accumulating an offset with no visible effect.
 */
export function clampReorderExposure(
  steps: number,
  focusedDisplayIndex: number,
  layerCount: number,
): number {
  const count = Math.max(0, Math.floor(layerCount));
  if (count === 0) return 0;
  const focused = Math.min(Math.max(Math.round(focusedDisplayIndex), 0), count - 1);
  const requested = Number.isFinite(steps) ? Math.round(steps) : 0;
  const clamped = Math.min(Math.max(requested, -focused), count - 1 - focused);
  // Normalised, because clamping against a zero bound yields -0, and a signed
  // zero reaching a data attribute or an equality check is a surprise nobody
  // reading the call site would predict.
  return clamped === 0 ? 0 : clamped;
}

/** True when another step in this direction would change nothing. */
export function reorderExposureExhausted(
  steps: number,
  direction: Exclude<ReorderEdge, null>,
  focusedDisplayIndex: number,
  layerCount: number,
): boolean {
  const delta = direction === "down" ? 1 : -1;
  const current = clampReorderExposure(steps, focusedDisplayIndex, layerCount);
  return clampReorderExposure(current + delta, focusedDisplayIndex, layerCount) === current;
}
