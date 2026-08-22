import { createContext, useContext } from "react";
import type { ContextHint, ContextHintContext, ContextHintRegistry } from "./context-hint-registry";

export const ContextHintRegistryContext = createContext<ContextHintRegistry | null>(null);

export function useContextHint(context: ContextHintContext): ContextHint | null {
  const registry = useContext(ContextHintRegistryContext);
  if (registry === null) throw new Error("Context hints require ContextHintProvider.");
  return registry.resolve(context);
}
