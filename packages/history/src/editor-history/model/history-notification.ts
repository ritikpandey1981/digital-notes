import type { HistoryError } from "../../errors";
import type { HistoryCommandMetadata, HistoryOperation } from "./history-metadata";
import type { IHistoryState } from "../state/history-state";

/** Immutable notification published after a successful History operation. */
export interface HistorySuccessNotification {
  readonly operation: HistoryOperation;
  readonly outcome: "succeeded";
  readonly command: HistoryCommandMetadata;
  readonly state: IHistoryState;
}

/** Immutable notification published after a failed History operation. */
export interface HistoryFailureNotification {
  readonly operation: HistoryOperation;
  readonly outcome: "failed";
  /** Null only when command-integrity validation could not produce metadata. */
  readonly command: HistoryCommandMetadata | null;
  readonly state: IHistoryState;
  readonly error: HistoryError;
}

/** Post-operation notification delivered only through the History controller. */
export type HistoryNotification = HistoryFailureNotification | HistorySuccessNotification;

/** Observer invoked with an immutable post-operation History notification. */
export type HistoryListener = (notification: HistoryNotification) => void;
