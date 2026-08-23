import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Delivers only the latest value once per browser frame during high-frequency UI input. */
export function useFrameCoalescedCallback<Value>(
  callback: (value: Value) => void,
): (value: Value) => void {
  const callbackRef = useRef(callback);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<Readonly<{ value: Value }> | null>(null);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      pendingRef.current = null;
    },
    [],
  );

  return useCallback((value: Value): void => {
    pendingRef.current = { value };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) callbackRef.current(pending.value);
    });
  }, []);
}
