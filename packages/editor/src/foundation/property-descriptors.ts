import {
  InkObject,
  createEditableColor,
  isVectorObject,
  type EditableColor,
  type PageObject,
  type PageObjectType,
} from "@folio/document";

export type EditablePropertyType = "color" | "number" | "boolean" | "string" | "choice";

export interface EditablePropertyConstraints {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
  readonly choices?: readonly string[];
}

export interface EditablePropertyDescriptor<TValue = unknown> {
  readonly key: string;
  readonly type: EditablePropertyType;
  readonly displayName: string;
  readonly value: TValue;
  readonly constraints: EditablePropertyConstraints;
  readonly validate: (candidate: unknown) => boolean;
}

export interface EditablePropertyProvider<TObject extends PageObject = PageObject> {
  readonly objectType: PageObjectType;
  readonly describe: (object: TObject) => readonly EditablePropertyDescriptor[];
}

export interface PropertyDescriptorRegistry {
  readonly register: (provider: EditablePropertyProvider) => void;
  readonly unregister: (objectType: PageObjectType) => boolean;
  readonly describe: (object: PageObject) => readonly EditablePropertyDescriptor[];
  readonly registeredTypes: () => readonly PageObjectType[];
}

class PropertyDescriptorRegistryImplementation implements PropertyDescriptorRegistry {
  readonly #providers = new Map<PageObjectType, EditablePropertyProvider>();

  register(provider: EditablePropertyProvider): void {
    if (this.#providers.has(provider.objectType)) {
      throw new TypeError(
        "A property provider is already registered for '" + provider.objectType + "'.",
      );
    }
    this.#providers.set(provider.objectType, provider);
  }

  unregister(objectType: PageObjectType): boolean {
    return this.#providers.delete(objectType);
  }

  describe(object: PageObject): readonly EditablePropertyDescriptor[] {
    const provider = this.#providers.get(object.type);
    return provider === undefined ? Object.freeze([]) : provider.describe(object);
  }

  registeredTypes(): readonly PageObjectType[] {
    return Object.freeze([...this.#providers.keys()]);
  }
}

export function createPropertyDescriptorRegistry(): PropertyDescriptorRegistry {
  return new PropertyDescriptorRegistryImplementation();
}

export function createInkPropertyProvider(): EditablePropertyProvider {
  return Object.freeze({
    objectType: "ink" as const,
    describe: (object: PageObject) => {
      if (!(object instanceof InkObject)) {
        throw new TypeError("The ink property provider requires an InkObject.");
      }
      const color = createEditableColor({
        hex: object.style.color,
        opacity: object.style.opacity,
      });
      return Object.freeze([
        colorDescriptor("strokeColor", "Stroke color", color),
        numberDescriptor("strokeWidth", "Stroke width", object.style.width, 0.25, 64, 0.25),
        numberDescriptor("opacity", "Opacity", object.style.opacity, 0, 1, 0.05),
      ]);
    },
  });
}

export function createVectorPropertyProvider(
  objectType: Exclude<PageObjectType, "ink">,
): EditablePropertyProvider {
  return Object.freeze({
    objectType,
    describe: (object: PageObject) => {
      if (!isVectorObject(object) || object.type !== objectType) {
        throw new TypeError(`The ${objectType} property provider requires a matching object.`);
      }
      return Object.freeze([
        colorDescriptor("strokeColor", "Stroke color", object.style.strokeColor),
        numberDescriptor("strokeWidth", "Stroke width", object.style.strokeWidth, 0.25, 64, 0.25),
        numberDescriptor("opacity", "Opacity", object.style.strokeColor.opacity, 0, 1, 0.05),
      ]);
    },
  });
}

export function createDefaultPropertyDescriptorRegistry(): PropertyDescriptorRegistry {
  const registry = createPropertyDescriptorRegistry();
  registry.register(createInkPropertyProvider());
  registry.register(createVectorPropertyProvider("line"));
  registry.register(createVectorPropertyProvider("rectangle"));
  registry.register(createVectorPropertyProvider("ellipse"));
  return registry;
}

function colorDescriptor(
  key: string,
  displayName: string,
  value: EditableColor,
): EditablePropertyDescriptor<EditableColor> {
  return Object.freeze({
    key,
    type: "color",
    displayName,
    value,
    constraints: Object.freeze({}),
    validate: (candidate: unknown): boolean =>
      candidate !== null &&
      typeof candidate === "object" &&
      "hex" in candidate &&
      typeof candidate.hex === "string",
  });
}

function numberDescriptor(
  key: string,
  displayName: string,
  value: number,
  minimum: number,
  maximum: number,
  step: number,
): EditablePropertyDescriptor<number> {
  return Object.freeze({
    key,
    type: "number",
    displayName,
    value,
    constraints: Object.freeze({ minimum, maximum, step }),
    validate: (candidate: unknown): boolean =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= minimum &&
      candidate <= maximum,
  });
}
