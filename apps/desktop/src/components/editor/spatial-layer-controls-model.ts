import { canDeleteLayer } from "./layers-panel-model";
import type { TransientPresentationPhase } from "../../motion/transient-presentation";

/**
 * Presentation rules for the focused sheet's contextual controls.
 *
 * Pure: no DOM, no document, no state. The component decides *where* a sheet is
 * from the frozen stack geometry and asks this module *what* may be shown there
 * and *what it is called*, so the answers can be tested without a window and so
 * the stack model itself stays untouched by Phase 3.
 *
 * Nothing here mutates anything. Every action the cluster offers is executed
 * through the existing `LayerActions`.
 */

/**
 * Only the focused sheet carries controls.
 *
 * This is the whole product principle in one predicate. The stack is a spatial
 * view of an arrangement, not a perspective rendering of a layers sidebar: six
 * identical toolbars stacked in depth would be exactly the compressed overview
 * the arrangement exists to replace. Neighbours keep their name, their edge and
 * their passive markers, and nothing else.
 */
export function sheetShowsControls(layerId: string, activeLayerId: string): boolean {
  return layerId === activeLayerId;
}

/**
 * Whether the cluster may be pressed at this moment of the choreography.
 *
 * Matches the sheets themselves rather than inventing a second rule: a control
 * that is still travelling must not catch a click aimed at where it is going,
 * and a stack that has begun closing has already given up the workspace.
 */
export function controlsInteractive(phase: TransientPresentationPhase): boolean {
  return phase === "open";
}

/** Compact chrome, sized to sit beside a sheet rather than to fill a panel. */
export const SPATIAL_CONTROL_METRICS = Object.freeze({
  /** One control's square footprint. */
  buttonSize: 24,
  /** Controls in the row: visibility, lock, opacity, rename, delete. */
  buttonCount: 5,
  /** Clear air between the control row and the opacity disclosure below it. */
  disclosureGap: 6,
  /** The opacity popover's own width; its slider has a 166px minimum. */
  disclosureWidth: 182,
  /** Its measured height: a labelled value row above a full-width track. */
  disclosureHeight: 74,
  /** Kept inside the measured bounds by this much on either side. */
  edgeInset: 8,
});

/** The control row's natural width, so callers do not re-derive it. */
export const SPATIAL_CONTROL_ROW_WIDTH =
  SPATIAL_CONTROL_METRICS.buttonSize * SPATIAL_CONTROL_METRICS.buttonCount;

/**
 * Horizontal shift that keeps the opacity disclosure inside the workspace.
 *
 * The cluster hangs off a sheet's projected corner, and how far right that
 * lands depends on the page shape, the tilt and the sheet's own depth. At a
 * small window the disclosure would otherwise run under the utility rail, so it
 * slides back along its anchor instead of the stack moving to accommodate it.
 *
 * Negative moves the disclosure left. Zero means it already fits.
 */
export function resolveDisclosureShift(
  anchorLeft: number,
  boundsWidth: number,
  disclosureWidth: number = SPATIAL_CONTROL_METRICS.disclosureWidth,
): number {
  const inset = SPATIAL_CONTROL_METRICS.edgeInset;
  const overflow = anchorLeft + disclosureWidth - (boundsWidth - inset);
  if (overflow <= 0) return 0;
  // Never past the left edge: a disclosure pushed off-screen is worse than one
  // that overlaps its own sheet.
  return -Math.min(overflow, Math.max(0, anchorLeft - inset));
}

export type SpatialLayerControl = "visibility" | "lock" | "rename" | "opacity" | "add" | "delete";

/** One control's resolved presentation, derived from live snapshot state. */
export interface SpatialControlState {
  readonly label: string;
  /** `aria-pressed`, for the controls that are genuine toggles. */
  readonly pressed?: boolean;
  readonly disabled: boolean;
}

interface LayerControlInput {
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly layerCount: number;
  readonly opacityOpen: boolean;
}

/**
 * Accessible names and enablement for the focused sheet's controls.
 *
 * Names are built from the layer's real name, never from its position: a sheet
 * called "Underdrawing" must not announce itself as "Layer 4". Wording matches
 * the list presentation exactly, because the two are the same action reached
 * from two places and a screen reader user should not have to learn both.
 */
export function resolveSpatialControls(
  input: LayerControlInput,
): Readonly<Record<SpatialLayerControl, SpatialControlState>> {
  const percent = Math.round(clampUnit(input.opacity) * 100);
  return Object.freeze({
    visibility: Object.freeze({
      label: input.visible ? `Hide ${input.name}` : `Show ${input.name}`,
      pressed: input.visible,
      disabled: false,
    }),
    lock: Object.freeze({
      label: input.locked ? `Unlock ${input.name}` : `Lock ${input.name}`,
      pressed: input.locked,
      disabled: false,
    }),
    rename: Object.freeze({ label: `Rename ${input.name}`, disabled: false }),
    opacity: Object.freeze({
      label: `${input.name} opacity, ${percent} percent`,
      pressed: input.opacityOpen,
      disabled: false,
    }),
    add: Object.freeze({ label: "Add layer", disabled: false }),
    // The final remaining Layer is not removable, so the control says so rather
    // than failing on press. Same rule as the list; there is only one.
    delete: Object.freeze({
      label: `Delete ${input.name}`,
      disabled: !canDeleteLayer(input.layerCount),
    }),
  });
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export type DisclosureSide = "above" | "below";

/**
 * Which side of the cluster the opacity disclosure opens on.
 *
 * The focused sheet is held on a shelf near the bottom of the workspace, so
 * there is usually no room beneath its label for a panel -- opening downward
 * there would run the disclosure under the zoom controls or off the workspace
 * entirely. Above the cluster is the empty band beside the sheet, which is
 * exactly where a transient panel belongs.
 *
 * The cluster is anchored by its *bottom* edge at the sheet's projected corner,
 * so `anchorBottom` is that corner's distance from the top of the bounds.
 */
export function resolveDisclosureSide(
  anchorBottom: number,
  boundsHeight: number,
  disclosureHeight: number = SPATIAL_CONTROL_METRICS.disclosureHeight,
): DisclosureSide {
  const needed = disclosureHeight + SPATIAL_CONTROL_METRICS.disclosureGap;
  const roomBelow = boundsHeight - SPATIAL_CONTROL_METRICS.edgeInset - anchorBottom;
  if (roomBelow >= needed) return "below";
  // Only when neither side fits does it stay below, where it is at least
  // adjacent to the control that opened it rather than floating off the top.
  return anchorBottom - needed >= SPATIAL_CONTROL_METRICS.edgeInset ? "above" : "below";
}
