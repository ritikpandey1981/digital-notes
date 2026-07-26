import type { DomainId, IsoTimestamp } from "./types";

export interface DomainFactoryContext {
  readonly createId: () => DomainId;
  readonly now: () => IsoTimestamp;
}

export type DomainFactoryContextOverrides = Partial<DomainFactoryContext>;

const defaultContext: DomainFactoryContext = {
  createId: () => globalThis.crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export function resolveFactoryContext(
  overrides: DomainFactoryContextOverrides = {},
): DomainFactoryContext {
  return {
    createId: overrides.createId ?? defaultContext.createId,
    now: overrides.now ?? defaultContext.now,
  };
}
