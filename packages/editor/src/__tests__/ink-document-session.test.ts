import { InkObject } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { InkDocumentSession } from "../InkDocumentSession";

function stroke(id: string) {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  builder.addPoint({
    x: 1,
    y: 2,
    timestamp: 0,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
  });
  return builder.finalize();
}

describe("InkDocumentSession", () => {
  it("converts every finalized stroke into exactly one immutable InkObject", () => {
    let id = 0;
    const session = new InkDocumentSession({
      createId: () => `object-${++id}`,
      now: () => "2026-07-27T08:00:00.000Z",
    });
    const firstStroke = stroke("stroke-1");
    const first = session.completeStroke(firstStroke);
    const second = session.completeStroke(stroke("stroke-2"));

    expect(first).toBeInstanceOf(InkObject);
    expect(first.stroke).toBe(firstStroke);
    expect(session.collection.objects).toEqual([first, second]);
    expect(session.collection.objects.map(({ zIndex }) => zIndex)).toEqual([0, 1]);
    expect(session.snapshot()).toEqual({
      objectCount: 2,
      inkObjectCount: 2,
      allObjectsImmutable: true,
    });
  });

  it("clears all session objects without touching the immutable strokes", () => {
    const session = new InkDocumentSession({
      createId: () => "object",
      now: () => "2026-07-27T08:00:00.000Z",
    });
    const source = stroke("stroke");
    session.completeStroke(source);
    session.clear();
    expect(session.snapshot().objectCount).toBe(0);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it("replaces an object immutably while retaining identity and stroke geometry", () => {
    let now = "2026-07-27T08:00:00.000Z";
    const session = new InkDocumentSession({
      createId: () => "object",
      now: () => now,
    });
    const sourceStroke = stroke("stroke");
    const original = session.completeStroke(sourceStroke);
    now = "2026-07-27T08:01:00.000Z";
    const translated = session.translateObject(original.id, { x: 40, y: -15 });

    expect(translated).not.toBe(original);
    expect(translated?.id).toBe(original.id);
    expect(translated?.stroke).toBe(sourceStroke);
    expect(translated?.transform.translation).toEqual({ x: 40, y: -15 });
    expect(translated?.bounds).toEqual({
      x: original.bounds.x + 40,
      y: original.bounds.y - 15,
      width: original.bounds.width,
      height: original.bounds.height,
    });
    expect(session.collection.lookup(original.id)).toBe(translated);
    expect(original.transform.translation).toEqual({ x: 0, y: 0 });
    expect(session.translateObject("missing", { x: 1, y: 1 })).toBeNull();
  });
});
