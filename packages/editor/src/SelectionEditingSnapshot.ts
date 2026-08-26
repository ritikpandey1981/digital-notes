import { InkObject, isVectorObject, type ObjectBounds, type PageObject } from "@folio/document";
import { inkStyleValues } from "./InkStyleEdit";

/** Kind label describing what the current selection contains. */
export type SelectionEditingKind = "line" | "rectangle" | "ellipse" | "ink" | "mixed";

/** Resolved appearance shared by the whole selection. */
export interface SelectionEditingStyle {
  readonly kind: SelectionEditingKind;
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly opacity: number;
}

function styleOf(object: PageObject): Omit<SelectionEditingStyle, "kind"> | null {
  if (object instanceof InkObject) {
    const values = inkStyleValues(object);
    return { strokeColor: values.color, strokeWidth: values.width, opacity: values.opacity };
  }
  if (isVectorObject(object)) {
    return {
      strokeColor: object.style.strokeColor.hex,
      strokeWidth: object.style.strokeWidth,
      opacity: object.style.strokeColor.opacity,
    };
  }
  return null;
}

/**
 * Resolves the appearance the contextual toolbar shows for a selection.
 *
 * The primary object supplies the displayed values, so a mixed selection shows
 * the values of the object the user most recently added rather than inventing a
 * blended value that belongs to nothing.
 */
export function resolveSelectionEditingStyle(
  objects: readonly PageObject[],
): SelectionEditingStyle | null {
  const primary = objects.at(-1);
  if (primary === undefined) return null;
  const primaryStyle = styleOf(primary);
  if (primaryStyle === null) return null;
  const types = new Set(
    objects.map((object) => (object instanceof InkObject ? "ink" : object.type)),
  );
  const kind: SelectionEditingKind =
    types.size === 1 ? (primary instanceof InkObject ? "ink" : primary.type) : "mixed";
  return Object.freeze({ kind, ...primaryStyle });
}

/** Axis-aligned union of every selected object's bounds. */
export function selectionUnionBounds(objects: readonly PageObject[]): ObjectBounds | null {
  if (objects.length === 0) return null;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    minimumX = Math.min(minimumX, object.bounds.x);
    minimumY = Math.min(minimumY, object.bounds.y);
    maximumX = Math.max(maximumX, object.bounds.x + object.bounds.width);
    maximumY = Math.max(maximumY, object.bounds.y + object.bounds.height);
  }
  return Object.freeze({
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  });
}
