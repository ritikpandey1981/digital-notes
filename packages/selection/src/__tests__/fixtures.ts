import { ObjectFactory, type InkObject, type PageObject } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import type { PagePoint, ScreenPoint, SelectionObjectSource } from "../index";

interface InkFixtureOptions {
  readonly id?: string;
  readonly zIndex?: number;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly width?: number;
  readonly pressureEnabled?: boolean;
  readonly points?: readonly {
    readonly x: number;
    readonly y: number;
    readonly pressure?: number;
  }[];
}

export function createInkFixture(options: InkFixtureOptions = {}): InkObject {
  const points = options.points ?? [
    { x: 10, y: 10 },
    { x: 110, y: 10 },
  ];
  const builder = new StrokeBuilder({
    id: `stroke-${options.id ?? "object"}`,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
    style: {
      width: options.width ?? 4,
      pressureEnabled: options.pressureEnabled ?? false,
    },
  });
  points.forEach((point, index) => {
    builder.addPoint({
      x: point.x,
      y: point.y,
      timestamp: index * 10,
      pressure: point.pressure ?? 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
    });
  });
  return new ObjectFactory({
    createId: () => options.id ?? "object-1",
    now: () => "2026-07-27T10:00:00.000Z",
  }).createInkObject({
    stroke: builder.finalize(),
    zIndex: options.zIndex ?? 0,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
  });
}

export function createObjectSource(
  initialObjects: readonly PageObject[],
): SelectionObjectSource & { setObjects(objects: readonly PageObject[]): void } {
  let objects = initialObjects;
  return {
    getObjects: () => objects,
    getObject: (objectId) => objects.find((object) => object.id === objectId),
    setObjects: (nextObjects) => {
      objects = nextObjects;
    },
  };
}

export function pagePoint(x: number, y: number): PagePoint {
  return Object.freeze({ x, y, coordinateSpace: "page" });
}

export function screenPoint(x: number, y: number): ScreenPoint {
  return Object.freeze({ x, y, coordinateSpace: "screen" });
}
