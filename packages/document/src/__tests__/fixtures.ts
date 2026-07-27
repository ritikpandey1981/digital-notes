import { StrokeBuilder, StrokeSmoother, type Stroke } from "@folio/ink";

export const FIRST_TIMESTAMP = "2026-07-27T08:00:00.000Z";
export const SECOND_TIMESTAMP = "2026-07-27T08:01:00.000Z";

export function createStroke(id = "stroke-1", offset = 0): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: offset,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  builder.addPoint({
    x: 10 + offset,
    y: 20 + offset,
    timestamp: offset,
    pressure: 0.25,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  });
  builder.addPoint({
    x: 30 + offset,
    y: 40 + offset,
    timestamp: offset + 10,
    pressure: 0.75,
    tiltX: 10,
    tiltY: -5,
    twist: 45,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  });
  return builder.finalize();
}
