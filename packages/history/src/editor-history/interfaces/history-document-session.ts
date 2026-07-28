/**
 * Model-neutral boundary through which History reads and replaces the active
 * immutable document.
 *
 * The owning editor session decides how a successor is installed. History does
 * not know the concrete document type or mutate the returned value.
 */
export interface HistoryDocumentSession<TDocument> {
  /** Returns the active immutable document reference. */
  readonly getDocument: () => TDocument;
  /** Replaces the active reference with an immutable command successor. */
  readonly replaceDocument: (document: TDocument) => void;
}
