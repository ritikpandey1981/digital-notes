import type { PageDocument, PageObject } from "@folio/document";
import type { EditorCommand } from "@folio/history";
import type {
  DeleteManipulationResult,
  DuplicateManipulationResult,
  ManipulationResult,
  RotationManipulationResult,
  ScaleManipulationResult,
  TranslationManipulationResult,
} from "@folio/manipulation";
import { createDeleteCommand } from "./delete-command";
import { createDuplicateCommand } from "./duplicate-command";
import { createMoveCommand } from "./move-command";
import { createRotateCommand } from "./rotate-command";
import { createScaleCommand } from "./scale-command";

interface ManipulationCommandContext {
  readonly document: PageDocument;
  readonly timestamp: string;
  /** Destination Layer for newly created artwork such as duplicates. */
  readonly activeLayerId: string;
}

/**
 * Editor-owned adaptation seam from subsystem results to History commands.
 * The result union and exhaustive switch keep History and Manipulation unaware
 * of one another while making each future command adapter explicit.
 */
export function createCommandForManipulation(
  result: ManipulationResult,
  context: ManipulationCommandContext,
): EditorCommand<PageDocument> {
  switch (result.kind) {
    case "translation":
      return createTranslationCommand(result, context);
    case "rotation":
      return createRotationCommand(result, context);
    case "scale":
      return createScaleManipulationCommand(result, context);
    case "delete":
      return createDeleteManipulationCommand(result, context);
    case "duplicate":
      return createDuplicateManipulationCommand(result, context);
  }
}

function createDeleteManipulationCommand(
  result: DeleteManipulationResult,
  context: ManipulationCommandContext,
): EditorCommand<PageDocument> {
  const object = currentObject(result.objectId, context.document);
  const layerId = context.document.layerIdForObject(object.id);
  if (layerId === undefined) {
    throw new Error(`Object '${object.id}' has no owning Layer and cannot be deleted.`);
  }
  return createDeleteCommand({
    deletedObject: object,
    originalInsertionIndex: object.zIndex,
    layerId,
    id: `delete-${result.sessionId}`,
    timestamp: nextRevisionTimestamp(object.modifiedAt, context.timestamp),
    description: `Delete object ${result.objectId}`,
  });
}

function createDuplicateManipulationCommand(
  result: DuplicateManipulationResult,
  context: ManipulationCommandContext,
): EditorCommand<PageDocument> {
  const object = currentObject(result.objectId, context.document);
  // Frozen decision: duplicates enter the active Layer. When the source already
  // lives there the duplicate stays directly above it; otherwise it appends.
  const activeLayerId = context.document.resolveActiveLayerId(context.activeLayerId);
  const insertionIndex =
    context.document.layerIdForObject(object.id) === activeLayerId
      ? object.zIndex + 1
      : context.document.appendIndexFor(activeLayerId);
  return createDuplicateCommand({
    sourceObject: object,
    insertionIndex,
    layerId: activeLayerId,
    id: `duplicate-${result.sessionId}`,
    timestamp: nextRevisionTimestamp(object.modifiedAt, context.timestamp),
    description: `Duplicate object ${result.objectId}`,
  });
}

function createRotationCommand(
  result: RotationManipulationResult,
  context: ManipulationCommandContext,
): EditorCommand<PageDocument> {
  const expectedObjectModifiedAt = currentRevision(result.objectId, context.document);
  return createRotateCommand({
    objectId: result.objectId,
    expectedObjectModifiedAt,
    initialRotation: result.initialObjectRotation,
    finalRotation: result.finalObjectRotation,
    id: `rotate-${result.sessionId}`,
    timestamp: nextRevisionTimestamp(expectedObjectModifiedAt, context.timestamp),
    description: `Rotate object ${result.objectId}`,
  });
}

function createScaleManipulationCommand(
  result: ScaleManipulationResult,
  context: ManipulationCommandContext,
): EditorCommand<PageDocument> {
  const expectedObjectModifiedAt = currentRevision(result.objectId, context.document);
  return createScaleCommand({
    objectId: result.objectId,
    expectedObjectModifiedAt,
    initialScale: result.initialObjectScale,
    finalScale: result.finalObjectScale,
    id: `scale-${result.sessionId}`,
    timestamp: nextRevisionTimestamp(expectedObjectModifiedAt, context.timestamp),
    description: `Scale object ${result.objectId}`,
  });
}

function createTranslationCommand(
  result: TranslationManipulationResult,
  context: ManipulationCommandContext,
): EditorCommand<PageDocument> {
  const expectedObjectModifiedAt = currentRevision(result.objectId, context.document);
  return createMoveCommand({
    objectId: result.objectId,
    expectedObjectModifiedAt,
    initialTranslation: result.initialObjectTranslation,
    finalTranslation: result.finalObjectTranslation,
    id: `move-${result.sessionId}`,
    timestamp: nextRevisionTimestamp(expectedObjectModifiedAt, context.timestamp),
    description: `Move object ${result.objectId}`,
  });
}

function currentRevision(objectId: string, document: PageDocument): string {
  const object = document.lookup(objectId);
  return object?.modifiedAt ?? new Date(0).toISOString();
}

function currentObject(objectId: string, document: PageDocument): PageObject {
  const object = document.lookup(objectId);
  if (object === undefined) {
    throw new TypeError(`Object '${objectId}' is not in the current document.`);
  }
  return object;
}

function nextRevisionTimestamp(currentRevision: string, candidate: string): string {
  const currentMilliseconds = Date.parse(currentRevision);
  const candidateMilliseconds = Date.parse(candidate);
  if (!Number.isFinite(currentMilliseconds) || !Number.isFinite(candidateMilliseconds)) {
    return candidate;
  }
  return new Date(Math.max(candidateMilliseconds, currentMilliseconds + 1)).toISOString();
}
