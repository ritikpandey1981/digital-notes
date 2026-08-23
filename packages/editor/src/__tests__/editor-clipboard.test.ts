import { InkObject, ObjectCollection, ObjectFactory, Transform } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { EditorClipboard } from "../EditorClipboard";
import { EditorSelectionSet } from "../EditorSelectionSet";

const TIMESTAMP = "2026-07-29T08:00:00.000Z";

describe("EditorClipboard", () => {
  it("keeps immutable references and prepares fresh multi-object clones with shared offsets", () => {
    const source = createCollection();
    let identity = 0;
    const clipboard = new EditorClipboard({
      createId: () => `paste-${++identity}`,
      now: () => TIMESTAMP,
    });

    expect(clipboard.copy(source.objects)).toBe(true);
    expect(clipboard.snapshot()).toEqual({ objectCount: 2, pasteCount: 0, canPaste: true });

    const first = clipboard.preparePaste(source);
    expect(first).not.toBeNull();
    if (first === null) throw new Error("Expected a prepared paste batch.");
    expect(first.offset).toEqual({ x: 20, y: 20 });
    expect(first.objects.map(({ id }) => id)).toEqual(["paste-1", "paste-2"]);
    expect(first.objects.map(({ transform }) => transform.translation)).toEqual([
      { x: 25, y: 30 },
      { x: 65, y: 50 },
    ]);
    expect(first.objects[0]?.bounds.x).toBeCloseTo((source.objects[0]?.bounds.x ?? 0) + 20);
    expect(first.objects[1]?.bounds.x).toBeCloseTo((source.objects[1]?.bounds.x ?? 0) + 20);
    expect(first.objects[0]?.metadata).toEqual(source.objects[0]?.metadata);
    expect(first.objects[0]?.type).toBe("ink");
    const pastedInk = first.objects[0];
    const sourceInk = source.objects[0];
    expect(pastedInk).toBeInstanceOf(InkObject);
    expect(sourceInk).toBeInstanceOf(InkObject);
    if (!(pastedInk instanceof InkObject) || !(sourceInk instanceof InkObject)) {
      throw new Error("Expected immutable ink clipboard fixtures.");
    }
    expect(pastedInk.stroke).toBe(sourceInk.stroke);
    expect(pastedInk.stroke.brush).toBe(sourceInk.stroke.brush);
    expect(pastedInk.renderingHints).toEqual(sourceInk.renderingHints);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.objects)).toBe(true);
    expect(Object.isFrozen(first.objects[0])).toBe(true);

    clipboard.confirmPaste(first);
    const second = clipboard.preparePaste(source);
    expect(second?.offset).toEqual({ x: 40, y: 40 });
    expect(second?.objects.map(({ transform }) => transform.translation)).toEqual([
      { x: 45, y: 50 },
      { x: 85, y: 70 },
    ]);
    expect(
      (second?.objects[1]?.transform.translation.x ?? 0) -
        (second?.objects[0]?.transform.translation.x ?? 0),
    ).toBe(40);
    expect(source.objects.map(({ transform }) => transform.translation)).toEqual([
      { x: 5, y: 10 },
      { x: 45, y: 30 },
    ]);
  });

  it("resets paste progression only when clipboard contents change", () => {
    const source = createCollection();
    let identity = 0;
    const clipboard = new EditorClipboard({
      createId: () => `paste-${++identity}`,
      now: () => TIMESTAMP,
    });
    clipboard.copy(source.objects);
    const first = clipboard.preparePaste(source);
    if (first === null) throw new Error("Expected first paste.");
    clipboard.confirmPaste(first);
    expect(clipboard.snapshot().pasteCount).toBe(1);

    clipboard.copy([source.objects[1]!]);

    expect(clipboard.snapshot()).toEqual({ objectCount: 1, pasteCount: 0, canPaste: true });
    expect(clipboard.preparePaste(source)?.offset).toEqual({ x: 20, y: 20 });
    clipboard.clear();
    expect(clipboard.preparePaste(source)).toBeNull();
  });

  it("rejects mutable, duplicate, and mismatched clipboard operations", () => {
    const source = createCollection();
    const clipboard = new EditorClipboard({
      createId: () => "paste",
      now: () => TIMESTAMP,
    });

    expect(clipboard.copy([])).toBe(false);
    expect(() => clipboard.copy([source.objects[0]!, source.objects[0]!])).toThrow(TypeError);
    expect(() => clipboard.copy([{ ...source.objects[0] } as never])).toThrow(TypeError);
    clipboard.copy([source.objects[0]!]);
    const prepared = clipboard.preparePaste(source);
    if (prepared === null) throw new Error("Expected prepared paste.");
    expect(() => clipboard.confirmPaste({ ...prepared, ordinal: 2 })).toThrowError(
      /does not match/u,
    );
  });
});

describe("EditorSelectionSet", () => {
  it("owns an ordered logical selection without changing document objects", () => {
    const document = createCollection();
    const selection = new EditorSelectionSet();

    expect(selection.replace(["second", "first", "second", ""])).toEqual(["second", "first"]);
    expect(selection.selectedObjects(document).map(({ id }) => id)).toEqual(["first", "second"]);
    expect(Object.isFrozen(selection.ids)).toBe(true);
    expect(document.objects.map(({ id }) => id)).toEqual(["first", "second"]);
  });

  it("selects editable objects and reconciles identities after document replacement", () => {
    const document = createCollection();
    const selection = new EditorSelectionSet();

    expect(selection.selectAllEditable(document)).toEqual(["first", "second"]);
    expect(selection.reconcile(document.remove("first"))).toEqual(["second"]);
    expect(selection.selectPrimary("second")).toEqual(["second"]);
    expect(selection.clear()).toEqual([]);
  });
});

function createCollection(): ObjectCollection {
  const factory = new ObjectFactory({ now: () => TIMESTAMP });
  return new ObjectCollection([
    factory.createInkObject({
      id: "first",
      zIndex: 0,
      metadata: { label: "one" },
      renderingHints: { color: "#123456", width: 3 },
      transform: new Transform({ translation: { x: 5, y: 10 }, rotation: 0.25, scale: 1.5 }),
      stroke: createStroke("first"),
    }),
    factory.createInkObject({
      id: "second",
      zIndex: 1,
      metadata: { label: "two" },
      transform: new Transform({ translation: { x: 45, y: 30 } }),
      stroke: createStroke("second"),
    }),
  ]);
}

function createStroke(id: string) {
  const builder = new StrokeBuilder({
    id: `stroke-${id}`,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (const [x, y, timestamp] of [
    [0, 0, 0],
    [10, 10, 10],
  ] as const) {
    builder.addPoint({
      x,
      y,
      timestamp,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
  }
  return builder.finalize();
}
