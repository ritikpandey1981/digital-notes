import {
  createDefaultLayer,
  ObjectCollection,
  PageDocument,
  type PageObject,
} from "@folio/document";
import { ObjectFactory } from "@folio/document";
import { describe, expect, it } from "vitest";
import { createEffectiveObjectState } from "../EffectiveObjectState";
import { firstErasableInkCandidate } from "../EraserEligibility";

const factory = new ObjectFactory();

function rectangle(id: string, options: { visible?: boolean; locked?: boolean } = {}): PageObject {
  return factory.createRectangleObject({
    id,
    geometry: { x: 0, y: 0, width: 10, height: 10 },
    style: { strokeColor: "#111111", strokeWidth: 1 },
    ...(options.visible === undefined ? {} : { visible: options.visible }),
    ...(options.locked === undefined ? {} : { locked: options.locked }),
  });
}

function pageWith(
  layerState: { visible?: boolean; locked?: boolean; opacity?: number },
  objects: readonly PageObject[],
): PageDocument {
  const layer = createDefaultLayer()
    .withPatch(layerState)
    .withObjectIds(objects.map((object) => object.id));
  return new PageDocument({ layers: [layer], objects: new ObjectCollection(objects) });
}

describe("EffectiveObjectState matrix", () => {
  const cases = [
    { layer: {}, object: {}, renderable: true, selectable: true, editable: true },
    {
      layer: { visible: false },
      object: {},
      renderable: false,
      selectable: false,
      editable: false,
    },
    { layer: { locked: true }, object: {}, renderable: true, selectable: true, editable: false },
    {
      layer: { visible: false, locked: true },
      object: {},
      renderable: false,
      selectable: false,
      editable: false,
    },
    {
      layer: {},
      object: { visible: false },
      renderable: false,
      selectable: false,
      editable: false,
    },
    { layer: {}, object: { locked: true }, renderable: true, selectable: true, editable: false },
    {
      layer: { locked: true },
      object: { locked: true },
      renderable: true,
      selectable: true,
      editable: false,
    },
    {
      layer: { visible: false },
      object: { visible: false },
      renderable: false,
      selectable: false,
      editable: false,
    },
  ] as const;

  for (const scenario of cases) {
    const label = `layer ${JSON.stringify(scenario.layer)} object ${JSON.stringify(scenario.object)}`;
    it(`resolves ${label}`, () => {
      const object = rectangle("target", scenario.object);
      const page = pageWith(scenario.layer, [object]);
      const effective = createEffectiveObjectState(() => page);

      expect(effective.renderable(object)).toBe(scenario.renderable);
      expect(effective.selectable(object)).toBe(scenario.selectable);
      expect(effective.editable(object)).toBe(scenario.editable);
      expect(effective.erasable(object)).toBe(scenario.editable);
    });
  }

  it("keeps a fully transparent layer logically visible and selectable", () => {
    const object = rectangle("target");
    const page = pageWith({ opacity: 0 }, [object]);
    const effective = createEffectiveObjectState(() => page);

    expect(effective.renderable(object)).toBe(true);
    expect(effective.selectable(object)).toBe(true);
    expect(effective.editable(object)).toBe(true);
    expect(effective.layerOpacity(object)).toBe(0);
  });

  it("reports layer opacity independently of object state", () => {
    const object = rectangle("target");
    const page = pageWith({ opacity: 0.5 }, [object]);
    const effective = createEffectiveObjectState(() => page);
    expect(effective.layerOpacity(object)).toBe(0.5);
  });

  it("identifies objects that are reachable but locked by their layer", () => {
    const object = rectangle("target");
    const locked = createEffectiveObjectState(() => pageWith({ locked: true }, [object]));
    const unlocked = createEffectiveObjectState(() => pageWith({}, [object]));

    expect(locked.lockedByLayer(object)).toBe(true);
    expect(unlocked.lockedByLayer(object)).toBe(false);
  });

  it("treats an object with no owning layer permissively", () => {
    const orphan = rectangle("orphan");
    const effective = createEffectiveObjectState(() => PageDocument.empty());
    expect(effective.renderable(orphan)).toBe(true);
    expect(effective.editable(orphan)).toBe(true);
    expect(effective.layerOpacity(orphan)).toBe(1);
  });

  it("reflects live page changes through the accessor", () => {
    const object = rectangle("target");
    let page = pageWith({}, [object]);
    const effective = createEffectiveObjectState(() => page);
    expect(effective.editable(object)).toBe(true);

    page = page.updateLayer("layer-1", { locked: true });
    expect(effective.editable(object)).toBe(false);
    expect(effective.selectable(object)).toBe(true);
  });
});

describe("Eraser eligibility with injected layer rules", () => {
  it("refuses candidates the resolver rejects and keeps default behavior otherwise", () => {
    const first = rectangle("first");
    const page = pageWith({ locked: true }, [first]);
    const effective = createEffectiveObjectState(() => page);

    expect(firstErasableInkCandidate([first], new Set(), effective.erasable)).toBeNull();
    expect(firstErasableInkCandidate([first], new Set())).toBeNull();
  });
});
