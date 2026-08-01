import type { IsoTimestamp, Position } from "@folio/domain";
import { DocumentObjectError } from "./errors";
import { InkObject } from "./ink-object";
import { Transform } from "./transform";
import { EllipseObject, LineObject, RectangleObject, isVectorObject } from "./vector-object";
import type {
  CloneObjectOptions,
  CreateEllipseObjectInput,
  CreateInkObjectInput,
  CreateLineObjectInput,
  CreateRectangleObjectInput,
  ObjectFactoryOptions,
  ObjectValidationResult,
  PageObject,
  VectorPageObject,
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

  createLineObject(input: CreateLineObjectInput): LineObject {
    const lifecycle = this.resolveLifecycle(input);
    return new LineObject({ ...lifecycle, geometry: input.geometry, style: input.style ?? {} });
  }

  createRectangleObject(input: CreateRectangleObjectInput): RectangleObject {
    const lifecycle = this.resolveLifecycle(input);
    return new RectangleObject({
      ...lifecycle,
      geometry: input.geometry,
      style: input.style ?? {},
    });
  }

  createEllipseObject(input: CreateEllipseObjectInput): EllipseObject {
    const lifecycle = this.resolveLifecycle(input);
    return new EllipseObject({ ...lifecycle, geometry: input.geometry, style: input.style ?? {} });
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
    if (isVectorObject(object)) {
      return this.createVectorReplacement(object, {
        id: options.id ?? this.createIdValue(),
        createdAt: timestamp,
        modifiedAt: timestamp,
        visible: options.visible ?? object.visible,
        locked: options.locked ?? object.locked,
        metadata: options.metadata ?? object.metadata,
        zIndex: options.zIndex ?? object.zIndex,
        transform: options.transform ?? object.transform,
        style: options.style ?? object.style,
      }) as unknown as TObject;
    }
    throw new DocumentObjectError("UNSUPPORTED_OBJECT_TYPE", "Object type cannot be cloned.", {
      type: object.type,
    });
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
    if (isVectorObject(object)) {
      return this.createVectorReplacement(object, {
        id: object.id,
        createdAt: object.createdAt,
        modifiedAt: this.nowValue(),
        visible: object.visible,
        locked: object.locked,
        metadata: object.metadata,
        zIndex: object.zIndex,
        transform: object.transform.translatedBy(delta),
        style: object.style,
      }) as unknown as TObject;
    }
    throw new DocumentObjectError("UNSUPPORTED_OBJECT_TYPE", "Object type cannot be translated.", {
      type: object.type,
    });
  }

  /** Creates a same-identity immutable replacement at an absolute rotation. */
  rotateObject<TObject extends PageObject>(object: TObject, rotation: number): TObject {
    assertValidObject(object);
    return this.replaceObjectTransform(object, object.transform.withRotation(rotation), "rotated");
  }

  /** Creates a same-identity immutable replacement at an absolute uniform scale. */
  scaleObject<TObject extends PageObject>(object: TObject, scale: number): TObject {
    assertValidObject(object);
    return this.replaceObjectTransform(object, object.transform.withScale(scale), "scaled");
  }

  validateObject(value: unknown): ObjectValidationResult {
    return validateObject(value);
  }

  private replaceObjectTransform<TObject extends PageObject>(
    object: TObject,
    transform: Transform,
    operation: "rotated" | "scaled",
  ): TObject {
    assertValidObject(object);
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
        transform,
        renderingHints: source.renderingHints,
      }) as unknown as TObject;
    }
    if (isVectorObject(object)) {
      return this.createVectorReplacement(object, {
        id: object.id,
        createdAt: object.createdAt,
        modifiedAt: this.nowValue(),
        visible: object.visible,
        locked: object.locked,
        metadata: object.metadata,
        zIndex: object.zIndex,
        transform,
        style: object.style,
      }) as unknown as TObject;
    }
    throw new DocumentObjectError(
      "UNSUPPORTED_OBJECT_TYPE",
      `Only InkObject can be ${operation}.`,
      { type: object.type },
    );
  }

  private resolveLifecycle(
    input: Pick<
      CreateLineObjectInput,
      "id" | "createdAt" | "modifiedAt" | "visible" | "locked" | "metadata" | "zIndex" | "transform"
    >,
  ) {
    const createdAt = input.createdAt ?? this.nowValue();
    return {
      id: input.id ?? this.createIdValue(),
      createdAt,
      modifiedAt: input.modifiedAt ?? createdAt,
      visible: input.visible ?? true,
      locked: input.locked ?? false,
      metadata: input.metadata ?? {},
      zIndex: input.zIndex ?? 0,
      transform: input.transform ?? Transform.identity(),
    } as const;
  }

  private createVectorReplacement(
    source: VectorPageObject,
    common: ReturnType<ObjectFactory["resolveLifecycle"]> & {
      readonly style: NonNullable<CloneObjectOptions["style"]>;
    },
  ): VectorPageObject {
    switch (source.type) {
      case "line":
        return new LineObject({ ...common, geometry: source.geometry });
      case "rectangle":
        return new RectangleObject({ ...common, geometry: source.geometry });
      case "ellipse":
        return new EllipseObject({ ...common, geometry: source.geometry });
    }
  }
}

export function createInkObject(
  input: CreateInkObjectInput,
  options: ObjectFactoryOptions = {},
): InkObject {
  return new ObjectFactory(options).createInkObject(input);
}

export function createLineObject(
  input: CreateLineObjectInput,
  options: ObjectFactoryOptions = {},
): LineObject {
  return new ObjectFactory(options).createLineObject(input);
}

export function createRectangleObject(
  input: CreateRectangleObjectInput,
  options: ObjectFactoryOptions = {},
): RectangleObject {
  return new ObjectFactory(options).createRectangleObject(input);
}

export function createEllipseObject(
  input: CreateEllipseObjectInput,
  options: ObjectFactoryOptions = {},
): EllipseObject {
  return new ObjectFactory(options).createEllipseObject(input);
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

export function rotateObject<TObject extends PageObject>(
  object: TObject,
  rotation: number,
  factoryOptions: ObjectFactoryOptions = {},
): TObject {
  return new ObjectFactory(factoryOptions).rotateObject(object, rotation);
}

export function scaleObject<TObject extends PageObject>(
  object: TObject,
  scale: number,
  factoryOptions: ObjectFactoryOptions = {},
): TObject {
  return new ObjectFactory(factoryOptions).scaleObject(object, scale);
}
