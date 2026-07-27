import type { IsoTimestamp, Position } from "@folio/domain";
import { DocumentObjectError } from "./errors";
import { InkObject } from "./ink-object";
import { Transform } from "./transform";
import type {
  CloneObjectOptions,
  CreateInkObjectInput,
  ObjectFactoryOptions,
  ObjectValidationResult,
  PageObject,
} from "./types";
import { assertValidObject, validateObject } from "./validation";

function defaultId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `object-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function defaultNow(): IsoTimestamp {
  return new Date().toISOString();
}

export class ObjectFactory {
  private readonly createIdValue: () => string;
  private readonly nowValue: () => IsoTimestamp;

  constructor(options: ObjectFactoryOptions = {}) {
    this.createIdValue = options.createId ?? defaultId;
    this.nowValue = options.now ?? defaultNow;
    Object.freeze(this);
  }

  createInkObject(input: CreateInkObjectInput): InkObject {
    const createdAt = input.createdAt ?? this.nowValue();
    return new InkObject({
      id: input.id ?? this.createIdValue(),
      createdAt,
      modifiedAt: input.modifiedAt ?? createdAt,
      visible: input.visible ?? true,
      locked: input.locked ?? false,
      metadata: input.metadata ?? {},
      zIndex: input.zIndex ?? 0,
      transform: input.transform ?? Transform.identity(),
      stroke: input.stroke,
      renderingHints: input.renderingHints ?? {},
    });
  }

  cloneObject<TObject extends PageObject>(
    object: TObject,
    options: CloneObjectOptions = {},
  ): TObject {
    assertValidObject(object);
    const timestamp = this.nowValue();
    if (object.type === "ink") {
      const source = object as unknown as InkObject;
      return this.createInkObject({
        id: options.id ?? this.createIdValue(),
        stroke: source.stroke,
        createdAt: timestamp,
        modifiedAt: timestamp,
        visible: options.visible ?? source.visible,
        locked: options.locked ?? source.locked,
        metadata: options.metadata ?? source.metadata,
        zIndex: options.zIndex ?? source.zIndex,
        transform: options.transform ?? source.transform,
        renderingHints: options.renderingHints ?? source.renderingHints,
      }) as unknown as TObject;
    }
    throw new DocumentObjectError(
      "UNSUPPORTED_OBJECT_TYPE",
      "Only InkObject can be cloned in Phase 8.",
      { type: object.type },
    );
  }

  /** Creates a same-identity immutable replacement translated in page space. */
  translateObject<TObject extends PageObject>(object: TObject, delta: Position): TObject {
    assertValidObject(object);
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
      throw new DocumentObjectError(
        "INVALID_OBJECT",
        "Object translation must contain finite page-space coordinates.",
        { delta },
      );
    }
    if (object.type === "ink") {
      const source = object as unknown as InkObject;
      return this.createInkObject({
        id: source.id,
        stroke: source.stroke,
        createdAt: source.createdAt,
        modifiedAt: this.nowValue(),
        visible: source.visible,
        locked: source.locked,
        metadata: source.metadata,
        zIndex: source.zIndex,
        transform: source.transform.translatedBy(delta),
        renderingHints: source.renderingHints,
      }) as unknown as TObject;
    }
    throw new DocumentObjectError(
      "UNSUPPORTED_OBJECT_TYPE",
      "Only InkObject can be translated in Phase 10.",
      { type: object.type },
    );
  }

  validateObject(value: unknown): ObjectValidationResult {
    return validateObject(value);
  }
}

export function createInkObject(
  input: CreateInkObjectInput,
  options: ObjectFactoryOptions = {},
): InkObject {
  return new ObjectFactory(options).createInkObject(input);
}

export function cloneObject<TObject extends PageObject>(
  object: TObject,
  cloneOptions: CloneObjectOptions = {},
  factoryOptions: ObjectFactoryOptions = {},
): TObject {
  return new ObjectFactory(factoryOptions).cloneObject(object, cloneOptions);
}

export function translateObject<TObject extends PageObject>(
  object: TObject,
  delta: Position,
  factoryOptions: ObjectFactoryOptions = {},
): TObject {
  return new ObjectFactory(factoryOptions).translateObject(object, delta);
}
