/**
 * One immutable, model-neutral editing operation accepted by History.
 *
 * The concrete command owns all document-specific validation. Each lifecycle
 * operation receives the current document and returns its immutable successor.
 * Commands never own stack, rendering, or UI behavior.
 */
export interface EditorCommand<TDocument> {
  /** Stable identity used throughout the command lifecycle. */
  readonly id: string;
  /** ISO-8601 timestamp assigned when the command is created. */
  readonly timestamp: string;
  /** Human-readable description of the completed editing operation. */
  readonly description: string;
  /** Applies the operation to the current immutable document. */
  readonly execute: (document: TDocument) => TDocument;
  /** Reverses the operation by producing a new immutable document. */
  readonly undo: (document: TDocument) => TDocument;
  /** Reapplies the operation by producing a new immutable document. */
  readonly redo: (document: TDocument) => TDocument;
}
