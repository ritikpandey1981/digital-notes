import type { PageObject } from "@folio/document";
import type { PagePoint } from "../model/coordinates";
import type { HitTestConfiguration, HitTestResult } from "../model/hit-test";

/** Read-only access to the active page's canonical document objects. */
export interface SelectionObjectSource {
  /** Returns objects without cloning them. */
  getObjects(): readonly PageObject[];

  /** Resolves one immutable document object by stable identity. */
  getObject(objectId: string): PageObject | undefined;
}

/** Pure page-space object discovery with replaceable spatial internals. */
export interface HitTestEngine {
  /** Returns the top-most visible hit or null when no object qualifies. */
  hitTest(position: PagePoint): HitTestResult | null;

  /** Returns visible nearby objects in deterministic top-most-first order. */
  queryNearby(position: PagePoint, radius?: number): readonly HitTestResult[];
}

/** Dependencies and tuning used to create a hit-test engine. */
export interface HitTestEngineOptions {
  readonly objectSource: SelectionObjectSource;
  readonly configuration?: Partial<HitTestConfiguration>;
}
