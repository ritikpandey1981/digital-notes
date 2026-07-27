import { describe, expect, it, vi } from "vitest";
import {
  createHitTestEngine,
  createSelectionController,
  createSelectionManager,
  type SelectionPointerInput,
} from "../index";
import { createInkFixture, createObjectSource, pagePoint, screenPoint } from "./fixtures";

function createHarness() {
  const object = createInkFixture({ id: "object-1" });
  const objectSource = createObjectSource([object]);
  const manager = createSelectionManager({ now: () => 10 });
  const hitTestEngine = createHitTestEngine({ objectSource });
  const coordinateMapper = {
    screenToPage: vi.fn((position: ReturnType<typeof screenPoint>) =>
      position.x < 100 || position.y < 100 ? null : pagePoint(position.x - 100, position.y - 100),
    ),
  };
  const controller = createSelectionController({
    manager,
    hitTestEngine,
    objectSource,
    coordinateMapper,
  });
  return { controller, object, objectSource, coordinateMapper };
}

function pointer(
  phase: SelectionPointerInput["phase"],
  x: number,
  y: number,
  overrides: Partial<SelectionPointerInput> = {},
): SelectionPointerInput {
  return {
    phase,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    position: screenPoint(x, y),
    ...overrides,
  };
}

describe("SelectionController", () => {
  it("converts screen coordinates and selects on a completed click", () => {
    const { controller, coordinateMapper } = createHarness();
    controller.handlePointer(pointer("down", 150, 110));
    const hit = controller.handlePointer(pointer("up", 150, 110));
    expect(hit?.objectId).toBe("object-1");
    expect(controller.getSelection().selectedObjectId).toBe("object-1");
    expect(coordinateMapper.screenToPage).toHaveBeenCalledWith(screenPoint(150, 110));
  });

  it("clears selection when a click resolves to empty page space", () => {
    const { controller } = createHarness();
    controller.selectObject("object-1");
    controller.handlePointer(pointer("down", 300, 300));
    expect(controller.handlePointer(pointer("up", 300, 300))).toBeNull();
    expect(controller.hasSelection()).toBe(false);
  });

  it("keeps the same state reference for repeated clicks on one object", () => {
    const { controller } = createHarness();
    controller.handlePointer(pointer("down", 150, 110));
    controller.handlePointer(pointer("up", 150, 110));
    const selected = controller.getSelection();
    controller.handlePointer(pointer("down", 150, 110));
    controller.handlePointer(pointer("up", 150, 110));
    expect(controller.getSelection()).toBe(selected);
  });

  it("ignores drags, secondary pointers, right clicks, and cancellations", () => {
    const { controller } = createHarness();
    controller.handlePointer(pointer("down", 150, 110));
    controller.handlePointer(pointer("move", 170, 130));
    controller.handlePointer(pointer("up", 170, 130));
    expect(controller.hasSelection()).toBe(false);

    controller.handlePointer(pointer("down", 150, 110, { isPrimary: false }));
    controller.handlePointer(pointer("up", 150, 110, { isPrimary: false }));
    controller.handlePointer(pointer("down", 150, 110, { button: 2 }));
    controller.handlePointer(pointer("up", 150, 110, { button: 2 }));
    controller.handlePointer(pointer("down", 150, 110));
    controller.handlePointer(pointer("cancel", 150, 110));
    controller.handlePointer(pointer("up", 150, 110));
    expect(controller.hasSelection()).toBe(false);
  });

  it("supports pure hit queries and graceful identity lookup", () => {
    const { controller } = createHarness();
    expect(controller.hitTest(screenPoint(150, 110))?.objectId).toBe("object-1");
    expect(controller.hasSelection()).toBe(false);
    const initial = controller.getSelection();
    expect(controller.selectObject("missing")).toBe(initial);
    expect(controller.selectObject("object-1").selectedObjectId).toBe("object-1");
    expect(controller.isSelected("object-1")).toBe(true);
  });

  it("notifies through the controller API and releases transient state on destroy", () => {
    const { controller } = createHarness();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.selectObject("object-1");
    unsubscribe();
    controller.clearSelection();
    controller.handlePointer(pointer("down", 150, 110));
    controller.destroy();
    expect(controller.handlePointer(pointer("up", 150, 110))).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("validates click movement configuration as a programming invariant", () => {
    const objectSource = createObjectSource([]);
    expect(() =>
      createSelectionController({
        manager: createSelectionManager(),
        hitTestEngine: createHitTestEngine({ objectSource }),
        objectSource,
        coordinateMapper: { screenToPage: () => null },
        clickMovementThreshold: -1,
      }),
    ).toThrow(RangeError);
  });
});
