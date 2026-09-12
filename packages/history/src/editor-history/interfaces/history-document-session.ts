declare const documentContentStateBrand: unique symbol;

/**
 * Runtime-only identity of one immutable document content state.
 *
 * Persistence compares a save checkpoint against this identity, so returning to
 * an already-visited content state must restore that state's original identity
 * rather than mint a new one. It is therefore deliberately not a timestamp, a
 * stack depth, or a History version, and it never reaches a project file.
 *
 * The brand keeps it opaque: only the owning document session can mint one.
 */
export type DocumentContentStateId = string & {
  readonly [documentContentStateBrand]: never;
};

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
  /**
   * Returns the identity of the content the session currently holds.
   *
   * Sessions with no persistence identity omit this pair. History then records
   * no identity and restores none, which keeps the generic contract usable for
   * documents that are never saved.
   */
  readonly getContentStateId?: () => DocumentContentStateId;
  /**
   * Reinstalls an identity this session previously minted.
   *
   * Undo, Redo, and rollback reach content that already existed, so History
   * restores the identity that content had. Minting a fresh one instead would
   * make undoing back to a saved state permanently dirty.
   */
  readonly restoreContentStateId?: (stateId: DocumentContentStateId) => void;
}
