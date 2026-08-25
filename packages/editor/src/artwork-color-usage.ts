import { InkObject, isVectorObject, type PageObject, type VectorPageObject } from "@folio/document";
import { normalizeArtworkHex } from "./foundation/color-conversion";

/** Returns the canonical color stored by one successfully committed artwork object. */
export function committedArtworkColor(object: PageObject): string {
  if (object instanceof InkObject) return normalizeArtworkHex(object.stroke.style.color);
  if (isVectorObject(object)) return normalizeArtworkHex(object.style.strokeColor.hex);
  throw new TypeError(`Artwork color usage is unsupported for '${object.type}'.`);
}

/** Returns the final canonical color only when a committed vector recolor changed net color. */
export function committedVectorRecolor(
  original: VectorPageObject,
  committed: VectorPageObject,
): string | null {
  if (original.id !== committed.id) {
    throw new TypeError("Committed vector recolor requires matching object identities.");
  }
  const originalColor = committedArtworkColor(original);
  const committedColor = committedArtworkColor(committed);
  return originalColor === committedColor ? null : committedColor;
}
