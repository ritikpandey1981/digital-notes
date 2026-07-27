import type { PageObject, PageObjectType } from "@folio/document";
import type { PagePoint } from "./coordinates";

/** Tunable page-space parameters used by object discovery. */
export interface HitTestConfiguration {
  /** Additional distance in page units allowed beyond rendered geometry. */
  readonly tolerance: number;
}

/** The immutable result of resolving a page-space point to a document object. */
export interface HitTestResult {
  readonly objectId: string;
  readonly objectType: PageObjectType;
  readonly objectReference: PageObject;
  readonly hitPosition: PagePoint;
  readonly hitDistance: number;
  readonly hitConfidence: number;
}

/** Default hit-test tuning, centralized for later pointer-specific adjustment. */
export const DEFAULT_HIT_TEST_CONFIGURATION: HitTestConfiguration = Object.freeze({
  tolerance: 6,
});
