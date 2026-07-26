export interface Selectable {
  readonly selectable: true;
}

export interface Movable {
  readonly movable: true;
}

export interface Resizable {
  readonly resizable: true;
}

export interface Rotatable {
  readonly rotatable: true;
}

export interface Editable {
  readonly editable: true;
}

export interface Serializable {
  readonly serializable: true;
}

export interface Renderable {
  readonly renderable: true;
}

export interface Lockable {
  readonly lockable: true;
}

export interface Groupable {
  readonly groupable: true;
}

export interface Searchable {
  readonly searchable: true;
}

export type PageObjectCapabilities = Partial<
  Selectable &
    Movable &
    Resizable &
    Rotatable &
    Editable &
    Serializable &
    Renderable &
    Lockable &
    Groupable &
    Searchable
>;

export const PAGE_OBJECT_CAPABILITY_NAMES = [
  "selectable",
  "movable",
  "resizable",
  "rotatable",
  "editable",
  "serializable",
  "renderable",
  "lockable",
  "groupable",
  "searchable",
] as const;

export type PageObjectCapabilityName = (typeof PAGE_OBJECT_CAPABILITY_NAMES)[number];

export const REQUIRED_PAGE_OBJECT_CAPABILITIES: Readonly<Serializable & Renderable> = Object.freeze(
  {
    serializable: true,
    renderable: true,
  },
);
