import {
  collectZones,
  hardZone,
  softZone,
  unionRects,
  type OccupiedZone,
  type WorkspaceRect,
} from "./editor-occupied-zones";

/**
 * The measured half of the occupied-zone model.
 *
 * Every persistent or temporary editor surface that a floating panel must stay
 * clear of is declared once, here, instead of being rediscovered by whichever
 * component happens to need it. Adding a surface to the editor now means adding
 * one row below rather than remembering every placement call site.
 */
interface EditorSurfaceDescriptor {
  readonly id: string;
  readonly selector: string;
  /** Descendant surfaces that extend the measured rectangle when present. */
  readonly expansionSelectors?: readonly string[];
}

const EDITOR_HARD_SURFACES: readonly EditorSurfaceDescriptor[] = Object.freeze([
  { id: "tool-dock", selector: "[data-tool-dock-layout]" },
  { id: "tool-options", selector: '[data-testid="context-tool-palette"]' },
  { id: "shapes-widget", selector: '[data-testid="shapes-widget"]' },
  { id: "utility-rail", selector: '[data-testid="workspace-utility-rail"]' },
  { id: "quick-color-rail", selector: '[data-testid="quick-color-rail"]' },
  { id: "layers-panel", selector: '[data-testid="layers-panel"]' },
  { id: "page-settings", selector: '[data-testid="page-settings"]' },
  { id: "page-navigator", selector: '[data-testid="page-navigator"]' },
  { id: "viewport-controls", selector: '[data-testid="viewport-controls"]' },
  {
    id: "selection-toolbar",
    selector: '[data-testid="shape-editing-toolbar"]',
    // An expanded Width or Opacity section hangs below the 48px bar. Measuring
    // only the bar is what let pickers land on top of an open slider.
    expansionSelectors: Object.freeze(["[data-toolbar-expansion-panel]"]),
  },
]);

/** Matches every declared hard surface, for observers that follow live chrome. */
export const OCCUPIED_SURFACE_SELECTOR = EDITOR_HARD_SURFACES.map(({ selector }) => selector).join(
  ", ",
);

/**
 * Reads one live rectangle, discarding surfaces that are hidden or unmounted.
 *
 * A surface hidden with `visibility` still reports a box. The selection toolbar
 * in particular parks at the workspace origin while nothing is selected, and
 * counting that phantom rectangle as occupied pushed real panels away from a
 * corner that was in fact free.
 */
export function measureSurfaceRect(element: Element | null | undefined): WorkspaceRect | undefined {
  if (element === null || element === undefined) return undefined;
  if (!isVisibleSurface(element)) return undefined;
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  return Object.freeze({
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  });
}

function isVisibleSurface(element: Element): boolean {
  // `opacityProperty` is deliberately left out: an entering panel spends a
  // frame at opacity 0 and should still reserve its space.
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true });
  }
  return getComputedStyle(element).visibility !== "hidden";
}

/** Measures one declared surface including any expanded contextual controls. */
function measureDescriptor(descriptor: EditorSurfaceDescriptor): WorkspaceRect | undefined {
  const element = document.querySelector(descriptor.selector);
  let rect = measureSurfaceRect(element);
  if (rect === undefined || descriptor.expansionSelectors === undefined) return rect;
  for (const expansionSelector of descriptor.expansionSelectors) {
    const expansion = measureSurfaceRect(element?.querySelector(expansionSelector));
    if (expansion !== undefined) rect = unionRects(rect, expansion);
  }
  return rect;
}

export interface EditorOccupiedZoneOptions {
  /** Surfaces to leave out, normally the one being placed. */
  readonly exclude?: readonly string[];
  /** Extra hard rectangles, such as the control that opened the surface. */
  readonly additionalHard?: readonly Readonly<{ id: string; rect: WorkspaceRect | undefined }>[];
  /** Regions to avoid where possible, normally the selected artwork. */
  readonly soft?: readonly Readonly<{ id: string; rect: WorkspaceRect | undefined }>[];
}

/** Measures the editor's live chrome into the shared zone vocabulary. */
export function collectEditorOccupiedZones(
  options: EditorOccupiedZoneOptions = {},
): readonly OccupiedZone[] {
  const excluded = new Set(options.exclude ?? []);
  return collectZones([
    ...EDITOR_HARD_SURFACES.filter((descriptor) => !excluded.has(descriptor.id)).map((descriptor) =>
      hardZone(descriptor.id, measureDescriptor(descriptor)),
    ),
    ...(options.additionalHard ?? []).map(({ id, rect }) => hardZone(id, rect)),
    ...(options.soft ?? []).map(({ id, rect }) => softZone(id, rect)),
  ]);
}
