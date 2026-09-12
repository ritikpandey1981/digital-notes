import { useEffect, type DependencyList, type EffectCallback } from "react";
import type { CanvasSurfaceProps } from "@folio/editor";

/** Desktop cursor/shortcut effects participate in the canvas's deferred activation. */
export function useRuntimeEffect(
  runtime: CanvasSurfaceProps["runtime"],
  effect: EffectCallback,
  dependencies: DependencyList,
): void {
  useEffect(() => {
    if (runtime === undefined) return effect();
    return runtime.entry.activation?.onActive(() => effect() ?? (() => undefined));
    // This hook deliberately follows useEffect's caller-supplied dependency contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, ...dependencies]);
}
