import { useMemo, type ReactNode } from "react";
import { ContextHintRegistryContext } from "./context-hint-context";
import { createContextHintRegistry, type ContextHintRegistry } from "./context-hint-registry";

export function ContextHintProvider({
  children,
  registry,
}: {
  readonly children: ReactNode;
  readonly registry?: ContextHintRegistry;
}) {
  const resolvedRegistry = useMemo(() => registry ?? createContextHintRegistry(), [registry]);
  return (
    <ContextHintRegistryContext.Provider value={resolvedRegistry}>
      {children}
    </ContextHintRegistryContext.Provider>
  );
}
