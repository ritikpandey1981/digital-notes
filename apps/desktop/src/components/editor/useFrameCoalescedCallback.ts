import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export type FrameCoalescedCallback<Value> = readonly [
  schedule: (value: Value) => void,
  flush: () => void,
  cancel: () => void,
];

/** Delivers only the latest value once per browser frame during high-frequency UI input. */
export function useFrameCoalescedCallback<Value>(
  callback: (value: Value) => void,
): FrameCoalescedCallback<Value> {
  const callbackRef = useRef(callback);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<Readonly<{ value: Value }> | null>(null);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback((): void => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingRef.current = null;
  }, []);

  const flush = useCallback((): void => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) callbackRef.current(pending.value);
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const schedule = useCallback((value: Value): void => {
    pendingRef.current = { value };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) callbackRef.current(pending.value);
    });
  }, []);

  return [schedule, flush, cancel];
}
