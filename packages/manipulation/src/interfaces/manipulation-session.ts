import type { PagePoint } from "@folio/selection";
import type { ManipulationState } from "../model/types";

/**
 * Internal-strategy contract for one continuous, deterministic interaction.
 * Managers own session lifetime; callers observe state through the manager.
 */
export interface ManipulationSession {
  /** Current immutable session state reference. */
  readonly state: ManipulationState;
  /** Recalculates state from an absolute page-space pointer position. */
  update(position: PagePoint): ManipulationState;
  /** Enters one legal terminal phase without releasing manager ownership. */
  transitionTo(phase: "committing" | "cancelling"): ManipulationState;
}
