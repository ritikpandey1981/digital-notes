# Folio Domain Model

`@folio/domain` contains Folio's framework-independent, in-memory notebook model. It has no React, Electron, rendering, persistence, or search dependencies.

Models are immutable plain objects containing only JSON-safe values. Dates are ISO-compatible strings, assets contain metadata rather than binary data or file-system paths, and aggregate operations return new notebooks instead of mutating their inputs.

## Aggregate model

```mermaid
classDiagram
  class Notebook {
    +DomainId id
    +string name
    +IsoTimestamp createdAt
    +IsoTimestamp updatedAt
    +NotebookCover cover
    +string theme
    +Section[] sections
    +Asset[] assets
    +NotebookSettings settings
  }

  class Section {
    +DomainId id
    +string title
    +Page[] pages
    +string? color
    +string? icon
  }

  class Page {
    +DomainId id
    +number width
    +number height
    +PageBackground background
    +PageObject[] objects
    +IsoTimestamp createdAt
    +IsoTimestamp updatedAt
  }

  class PageObject {
    +DomainId id
    +PageObjectType type
    +Position position
    +number rotation
    +boolean locked
    +boolean visible
    +PageObjectCapabilities capabilities
  }

  class Asset {
    +DomainId id
    +AssetKind kind
    +string fileName
    +string mediaType
    +number byteLength
    +IsoTimestamp createdAt
  }

  Notebook "1" *-- "0..*" Section
  Notebook "1" *-- "0..*" Asset
  Section "1" *-- "0..*" Page
  Page "1" *-- "0..*" PageObject
```

Pages are owned directly by one ordered section. There are no persistence-layer page references in the domain model; validation guarantees that every contained page is valid and that identifiers are unique throughout the notebook aggregate.

## Capability composition

Capabilities are dependency-free, serializable markers. They describe what an editor, renderer, or search adapter may do without placing those behaviors in the domain layer.

```mermaid
classDiagram
  class PageObject
  class Selectable
  class Movable
  class Resizable
  class Rotatable
  class Editable
  class Serializable
  class Renderable
  class Lockable
  class Groupable
  class Searchable

  PageObject "1" o-- "0..1" Selectable
  PageObject "1" o-- "0..1" Movable
  PageObject "1" o-- "0..1" Resizable
  PageObject "1" o-- "0..1" Rotatable
  PageObject "1" o-- "0..1" Editable
  PageObject "1" *-- "1" Serializable
  PageObject "1" *-- "1" Renderable
  PageObject "1" o-- "0..1" Lockable
  PageObject "1" o-- "0..1" Groupable
  PageObject "1" o-- "0..1" Searchable
```

All page objects must include `Serializable` and `Renderable`. Other capabilities are composed only when appropriate for the concrete object type.

## Public API groups

- Models and primitives: `Notebook`, `Section`, `Page`, `PageObject`, `Asset`, identifiers, timestamps, JSON values, covers, backgrounds, and discriminants.
- Factories: `createNotebook`, `createSection`, `createPage`, `createPageObject`, `createAsset`, and `duplicatePage`.
- Aggregate operations: notebook metadata, section CRUD/reordering, and page CRUD/duplication/reordering.
- Validation: standalone validators, `validateNotebook`, `assertValidNotebook`, `isNotebook`, structured issues, and `DomainValidationError`.
- Factory context: injectable identifier and clock functions for deterministic tests and platform-independent creation.
