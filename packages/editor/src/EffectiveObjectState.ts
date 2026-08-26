import type { PageDocument, PageObject } from "@folio/document";

/**
 * The single definition of how Layer state combines with object state.
 *
 * Every eligibility decision in the editor resolves through this value, so
 * layer rules are never restated inside individual controllers. Selection and
 * manipulation continue to receive plain object sources: the editor filters
 * them here rather than teaching those packages about Layers.
 */
export interface EffectiveObjectState {
  /** Drawn by the compositor. */
  readonly renderable: (object: PageObject) => boolean;
  /** Reachable by hit testing and selection, possibly read-only. */
  readonly selectable: (object: PageObject) => boolean;
  /**
   * Reachable by pointer selection: click, Shift+Click, marquee, and Alt cycling.
   *
   * Objects in a locked Layer stay reachable read-only. Individually locked
   * PageObjects remain unreachable, matching the editor hit-test engine so every
   * pointer route agrees on what can be picked.
   */
  readonly pointerSelectable: (object: PageObject) => boolean;
  /** Mutable: transform, style, and lifecycle edits are permitted. */
  readonly editable: (object: PageObject) => boolean;
  /** Removable by the Eraser. */
  readonly erasable: (object: PageObject) => boolean;
  /** True when the object is reachable but immutable because of Layer lock. */
  readonly lockedByLayer: (object: PageObject) => boolean;
  /** Presentation multiplier contributed by the owning Layer. */
  readonly layerOpacity: (object: PageObject) => number;
}

interface LayerPresentation {
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
}

const ORPHAN_PRESENTATION: LayerPresentation = Object.freeze({
  visible: true,
  locked: false,
  opacity: 1,
});

/** Resolves one object's owning Layer presentation, defaulting to permissive. */
function presentationFor(page: PageDocument, object: PageObject): LayerPresentation {
  const layerId = page.layerIdForObject(object.id);
  if (layerId === undefined) return ORPHAN_PRESENTATION;
  const layer = page.layer(layerId);
  if (layer === undefined) return ORPHAN_PRESENTATION;
  return layer;
}

/** Creates the editor-wide effective-state resolver over a live page accessor. */
export function createEffectiveObjectState(getPage: () => PageDocument): EffectiveObjectState {
  const renderable = (object: PageObject): boolean =>
    object.visible && presentationFor(getPage(), object).visible;
  // Layer opacity is presentation only: an invisible-but-present Layer at
  // opacity 0 stays reachable so the visibility toggle remains the one control
  // that removes artwork from interaction.
  const selectable = renderable;
  const editable = (object: PageObject): boolean => {
    if (!renderable(object) || object.locked) return false;
    return !presentationFor(getPage(), object).locked;
  };
  return Object.freeze({
    renderable,
    selectable,
    pointerSelectable: (object: PageObject): boolean => selectable(object) && !object.locked,
    editable,
    erasable: editable,
    lockedByLayer: (object: PageObject): boolean =>
      renderable(object) && presentationFor(getPage(), object).locked,
    layerOpacity: (object: PageObject): number => presentationFor(getPage(), object).opacity,
  });
}
