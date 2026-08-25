import {
  hexToHsv,
  hsvToHex,
  normalizeArtworkHex,
  type ColorTargetAdapter,
  type HsvColor,
} from "@folio/editor";
import { useCallback, useEffect, useRef, useState } from "react";

export type ColorPickerSource = "quick-rail" | "tool-settings" | "selected-vector";
export type ColorPreviewSchedule = "immediate" | "animation-frame";

export interface ColorPickerSessionSnapshot {
  readonly target: ColorTargetAdapter;
  readonly source: ColorPickerSource;
  readonly anchor: HTMLElement;
  readonly ownerScope: string | undefined;
  readonly currentColor: string;
  readonly previousColor: string;
  readonly hsv: HsvColor;
}

interface OpenColorPickerOptions {
  readonly target: ColorTargetAdapter;
  readonly source: ColorPickerSource;
  readonly anchor: HTMLElement;
  readonly ownerScope: string | undefined;
}

interface ColorPickerSessionActions {
  readonly snapshot: ColorPickerSessionSnapshot | null;
  readonly open: (options: OpenColorPickerOptions) => boolean;
  readonly previewHex: (
    color: string,
    schedule?: ColorPreviewSchedule,
  ) => ColorPickerSessionSnapshot | null;
  readonly previewHsv: (
    hsv: HsvColor,
    schedule?: ColorPreviewSchedule,
  ) => ColorPickerSessionSnapshot | null;
  readonly applyDirect: (target: ColorTargetAdapter, color: string) => boolean;
  readonly commit: () => boolean;
  readonly cancel: () => boolean;
}

/** Owns exactly one workspace color transaction and its frame-coalesced preview boundary. */
export function useColorPickerSession(): ColorPickerSessionActions {
  const [snapshot, setSnapshot] = useState<ColorPickerSessionSnapshot | null>(null);
  const snapshotRef = useRef<ColorPickerSessionSnapshot | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingColorRef = useRef<string | null>(null);

  const publish = useCallback((next: ColorPickerSessionSnapshot | null): void => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const cancelPendingPreview = useCallback((): void => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingColorRef.current = null;
  }, []);

  const flushPendingPreview = useCallback((): boolean => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const color = pendingColorRef.current;
    pendingColorRef.current = null;
    const active = snapshotRef.current;
    return color !== null && active !== null ? active.target.preview(color) : false;
  }, []);

  const cancel = useCallback((): boolean => {
    cancelPendingPreview();
    const active = snapshotRef.current;
    if (active === null) return false;
    publish(null);
    return active.target.cancel();
  }, [cancelPendingPreview, publish]);

  const commit = useCallback((): boolean => {
    flushPendingPreview();
    const active = snapshotRef.current;
    if (active === null) return false;
    publish(null);
    return active.target.commit();
  }, [flushPendingPreview, publish]);

  const open = useCallback(
    (options: OpenColorPickerOptions): boolean => {
      const active = snapshotRef.current;
      if (active?.target.id === options.target.id) {
        publish(
          Object.freeze({
            ...active,
            anchor: options.anchor,
            source: options.source,
            ownerScope: options.ownerScope,
          }),
        );
        return true;
      }
      if (active !== null) cancel();
      if (!options.target.begin()) return false;
      const currentColor = normalizeArtworkHex(options.target.getCurrentColor());
      const hsv = hexToHsv(currentColor);
      publish(
        Object.freeze({
          target: options.target,
          source: options.source,
          anchor: options.anchor,
          ownerScope: options.ownerScope,
          currentColor,
          previousColor: currentColor,
          hsv,
        }),
      );
      return true;
    },
    [cancel, publish],
  );

  const queueTargetPreview = useCallback(
    (color: string, schedule: ColorPreviewSchedule): boolean => {
      const active = snapshotRef.current;
      if (active === null) return false;
      if (schedule === "immediate") {
        flushPendingPreview();
        return active.target.preview(color);
      }
      pendingColorRef.current = color;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const pending = pendingColorRef.current;
          pendingColorRef.current = null;
          const current = snapshotRef.current;
          if (pending !== null && current !== null) current.target.preview(pending);
        });
      }
      return true;
    },
    [flushPendingPreview],
  );

  const previewHsv = useCallback(
    (
      hsv: HsvColor,
      schedule: ColorPreviewSchedule = "immediate",
    ): ColorPickerSessionSnapshot | null => {
      const active = snapshotRef.current;
      if (active === null) return null;
      const currentHsv = Object.freeze({ ...hsv });
      const color = hsvToHex(currentHsv);
      const next = Object.freeze({ ...active, currentColor: color, hsv: currentHsv });
      snapshotRef.current = next;
      queueTargetPreview(color, schedule);
      return next;
    },
    [queueTargetPreview],
  );

  const previewHex = useCallback(
    (
      input: string,
      schedule: ColorPreviewSchedule = "immediate",
    ): ColorPickerSessionSnapshot | null => {
      const active = snapshotRef.current;
      if (active === null) return null;
      const color = normalizeArtworkHex(input);
      const hsv = hexToHsv(color);
      const next = Object.freeze({ ...active, currentColor: color, hsv });
      snapshotRef.current = next;
      queueTargetPreview(color, schedule);
      return next;
    },
    [queueTargetPreview],
  );

  const applyDirect = useCallback(
    (target: ColorTargetAdapter, input: string): boolean => {
      const color = normalizeArtworkHex(input);
      const active = snapshotRef.current;
      if (active?.target.id === target.id) return previewHex(color) !== null;
      if (active !== null) cancel();
      if (!target.begin()) return false;
      const changed = target.preview(color);
      target.commit();
      return changed;
    },
    [cancel, previewHex],
  );

  useEffect(
    () => () => {
      cancelPendingPreview();
      snapshotRef.current?.target.cancel();
      snapshotRef.current = null;
    },
    [cancelPendingPreview],
  );

  return { snapshot, open, previewHex, previewHsv, applyDirect, commit, cancel };
}
