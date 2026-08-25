import { normalizeArtworkHex, type ColorTargetAdapter } from "@folio/editor";

interface HistoryFreeColorTargetOptions {
  readonly id: string;
  readonly label: string;
  readonly getColor: () => string;
  readonly setColor: (canonicalHex: string) => void;
}

interface ContinuousColorTargetOptions {
  readonly id: string;
  readonly label: string;
  readonly getColor: () => string;
  readonly beginContinuousEdit: () => boolean;
  readonly previewContinuousEdit: (canonicalHex: string) => boolean;
  readonly commitContinuousEdit: () => boolean;
  readonly cancelContinuousEdit: () => boolean;
}

/** Adapts one creation-style owner to the shared picker without creating History entries. */
export function createHistoryFreeColorTarget(
  options: HistoryFreeColorTargetOptions,
): ColorTargetAdapter {
  let active = false;
  let originalColor: string | null = null;

  const finish = (): void => {
    active = false;
    originalColor = null;
  };

  return Object.freeze({
    id: options.id,
    label: options.label,
    getCurrentColor: (): string => normalizeArtworkHex(options.getColor()),
    begin: (): boolean => {
      if (active) return false;
      originalColor = normalizeArtworkHex(options.getColor());
      active = true;
      return true;
    },
    preview: (canonicalHex: string): boolean => {
      if (!active) return false;
      const color = normalizeArtworkHex(canonicalHex);
      if (color === normalizeArtworkHex(options.getColor())) return false;
      options.setColor(color);
      return true;
    },
    commit: (): boolean => {
      if (!active) return false;
      const changed = normalizeArtworkHex(options.getColor()) !== originalColor;
      finish();
      return changed;
    },
    cancel: (): boolean => {
      if (!active) return false;
      const current = normalizeArtworkHex(options.getColor());
      const original = originalColor;
      finish();
      if (original === null || current === original) return false;
      options.setColor(original);
      return true;
    },
  });
}

/** Adapts the existing ContinuousVectorStyleEdit facade to the shared picker contract. */
export function createContinuousColorTarget(
  options: ContinuousColorTargetOptions,
): ColorTargetAdapter {
  let active = false;
  return Object.freeze({
    id: options.id,
    label: options.label,
    getCurrentColor: (): string => normalizeArtworkHex(options.getColor()),
    begin: (): boolean => {
      if (active) return false;
      active = options.beginContinuousEdit();
      return active;
    },
    preview: (canonicalHex: string): boolean =>
      active && options.previewContinuousEdit(normalizeArtworkHex(canonicalHex)),
    commit: (): boolean => {
      if (!active) return false;
      active = false;
      return options.commitContinuousEdit();
    },
    cancel: (): boolean => {
      if (!active) return false;
      active = false;
      return options.cancelContinuousEdit();
    },
  });
}
