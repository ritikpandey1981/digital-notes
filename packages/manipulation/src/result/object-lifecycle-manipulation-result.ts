import type {
  DeleteManipulationResult,
  DuplicateManipulationResult,
  ManipulationResultKind,
} from "../model/types";

export interface CreateObjectLifecycleManipulationResultInput {
  readonly objectId: string;
  readonly sessionId?: string;
  readonly sessionTimestamp?: number;
}

function createResult<TKind extends "delete" | "duplicate">(
  kind: TKind,
  input: CreateObjectLifecycleManipulationResultInput,
): Readonly<{
  kind: TKind;
  sessionId: string;
  objectId: string;
  sessionTimestamp: number;
}> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Object lifecycle manipulation requires an input object.");
  }
  if (typeof input.objectId !== "string" || input.objectId.trim().length === 0) {
    throw new TypeError("Object lifecycle manipulation requires a non-blank object ID.");
  }
  const sessionId = input.sessionId ?? defaultSessionId(kind);
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new TypeError("Object lifecycle manipulation requires a non-blank session ID.");
  }
  const sessionTimestamp = input.sessionTimestamp ?? Date.now();
  if (!Number.isFinite(sessionTimestamp)) {
    throw new TypeError("Object lifecycle manipulation requires a finite timestamp.");
  }
  return Object.freeze({ kind, sessionId, objectId: input.objectId, sessionTimestamp });
}

function defaultSessionId(kind: Extract<ManipulationResultKind, "delete" | "duplicate">): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

/** Creates one immutable logical deletion result without document or History state. */
export function createDeleteManipulationResult(
  input: CreateObjectLifecycleManipulationResultInput,
): DeleteManipulationResult {
  return createResult("delete", input);
}

/** Creates one immutable logical duplication result without document or History state. */
export function createDuplicateManipulationResult(
  input: CreateObjectLifecycleManipulationResultInput,
): DuplicateManipulationResult {
  return createResult("duplicate", input);
}
