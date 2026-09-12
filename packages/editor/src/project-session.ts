import type { FolioProjectMetadata, FolioProjectSnapshot } from "@folio/persistence/project";
import type { DocumentContentStateId } from "@folio/history";
import { InkDocumentSession } from "./InkDocumentSession";

/**
 * Read-only content-identity projection for persistence and future close guards.
 *
 * It answers only content questions. Whether a writable backing target exists is
 * a platform fact and stays with the desktop persistence coordinator.
 */
export interface ProjectContentState {
  readonly contentStateId: DocumentContentStateId;
  readonly baselineStateId: DocumentContentStateId;
  readonly checkpointStateId: DocumentContentStateId | null;
  readonly isDirty: boolean;
  readonly hasConfirmedCheckpoint: boolean;
}

/** One immutable project snapshot together with the content identity it holds. */
export interface ProjectPersistenceCapture {
  readonly project: FolioProjectSnapshot;
  readonly stateId: DocumentContentStateId;
}

/**
 * One project's lifetime, independent of its drawing surface and platform host.
 * The document lives only in documentSession; captures retain immutable roots.
 * This owner holds no subscriptions or external resources. Its host releases it
 * on unmount rather than clearing artwork during React effect cleanup/replay.
 */
export class ProjectSession {
  readonly metadata: FolioProjectMetadata;
  readonly documentSession: InkDocumentSession;
  readonly #baselineStateId: DocumentContentStateId;
  /** Null until a durable copy of a known content state is confirmed. */
  #checkpointStateId: DocumentContentStateId | null = null;

  constructor(initialProject: FolioProjectSnapshot) {
    this.metadata = Object.freeze({ ...initialProject.metadata });
    this.documentSession = new InkDocumentSession({ initialDocument: initialProject.sketchbook });
    this.#baselineStateId = this.documentSession.contentStateId;
    Object.freeze(this);
  }

  /** Identity of the content this project currently holds. */
  get contentStateId(): DocumentContentStateId {
    return this.documentSession.contentStateId;
  }

  /** Identity of the content this project started from, before any editing. */
  get baselineStateId(): DocumentContentStateId {
    return this.#baselineStateId;
  }

  /** Identity of the last content a durable write or load actually confirmed. */
  get checkpointStateId(): DocumentContentStateId | null {
    return this.#checkpointStateId;
  }

  /**
   * Whether content differs from its reference state.
   *
   * The reference is the confirmed checkpoint once one exists, and otherwise
   * the load baseline: an untouched project is not dirty merely because nothing
   * has been written to disk yet. That separate risk is reported by
   * {@link hasConfirmedCheckpoint}.
   */
  get isDirty(): boolean {
    return this.contentStateId !== (this.#checkpointStateId ?? this.#baselineStateId);
  }

  /** Whether a durable copy of a known content state has been confirmed. */
  get hasConfirmedCheckpoint(): boolean {
    return this.#checkpointStateId !== null;
  }

  contentState(): ProjectContentState {
    return Object.freeze({
      contentStateId: this.contentStateId,
      baselineStateId: this.#baselineStateId,
      checkpointStateId: this.#checkpointStateId,
      isDirty: this.isDirty,
      hasConfirmedCheckpoint: this.hasConfirmedCheckpoint,
    });
  }

  /** Captures the current root without copying artwork or retaining a second store. */
  captureSnapshot(): FolioProjectSnapshot {
    return Object.freeze({
      metadata: this.metadata,
      sketchbook: this.documentSession.getDocument(),
    });
  }

  /**
   * Captures artwork and its identity in one read.
   *
   * A write is asynchronous and editing continues during it, so the identity
   * must come from the same instant as the bytes; querying it afterwards could
   * checkpoint content that was never written.
   */
  capturePersistenceSnapshot(): ProjectPersistenceCapture {
    return Object.freeze({
      project: this.captureSnapshot(),
      stateId: this.contentStateId,
    });
  }

  /**
   * Records the exact content a durable write or load is confirmed to hold.
   *
   * Only a confirmed result may call this. A cancelled, failed, or unconfirmed
   * result leaves the previous checkpoint standing, because disk durability is
   * then unknown.
   */
  confirmDurableCheckpoint(stateId: DocumentContentStateId): void {
    if (typeof stateId !== "string" || stateId.length === 0) {
      throw new TypeError("A durable checkpoint requires a captured content identity.");
    }
    this.#checkpointStateId = stateId;
  }
}
