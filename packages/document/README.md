# @folio/document

Immutable live document model for the Folio sketchbook editor.

## Model

```text
SketchbookDocument
  ordered Page[]
    Page (identity, name, geometry, paper, content)
      PageDocument
        ordered Layer[] of ordered object IDs
        canonical flattened ObjectCollection
```

Implemented PageObject kinds are Ink, Line, Rectangle, and Ellipse. Objects have no
page or layer ownership fields. Layers own IDs; flattened collection order is the
canonical bottom-to-top render order, and object `zIndex` is normalized from position.

`PageDocument` validates Layer membership against the flattened collection so missing,
duplicate, orphaned, or reordered membership cannot silently exist. Transform and
factory helpers return immutable replacements. Page resizing changes the boundary and
does not destructively move out-of-bounds artwork.

Paper is Page state beneath artwork. It is not a PageObject, Layer, theme, or session
preference.

## Public surface

The package exports the sketchbook/page model, Layer and PageDocument, ObjectCollection,
object types and factories, transforms, vector serialization, editable styles, page
geometry/presets, and paper definitions.

Use `@folio/editor` commands for application mutations; UI code should not construct a
second document authority.

## Dependencies

Production dependencies: `@folio/domain` and `@folio/ink`. The domain dependency is
compatibility support, not evidence that the live sketchbook uses the older Notebook
model.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for system ownership and
[`../../docs/DECISIONS.md`](../../docs/DECISIONS.md) for invariants.
