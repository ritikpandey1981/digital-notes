import { ObjectFactory, type PageObject } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import type { SelectionState } from "@folio/selection";
import type { ManipulationObjectSource, ManipulationSelectionSource } from "../model/types";

export function pagePoint(x: number, y: number) {
  return Object.freeze({ x, y, coordinateSpace: "page" as const });
}

export function createObject(id = "object-1", locked = false, visible = true): PageObject {
  const builder = new StrokeBuilder({
    id: `stroke-${id}`,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  builder.addPoint({
    x: 10,
    y: 10,
    timestamp: 0,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
  });
  return new ObjectFactory({ now: () => "2026-07-27T12:00:00.000Z" }).createInkObject({
    id,
    stroke: builder.finalize(),
    locked,
    visible,
  });
}

export function createSources(initialObjects: readonly PageObject[], selectedId: string | null) {
  let objects = new Map(initialObjects.map((object) => [object.id, object]));
  let selection: SelectionState = state(selectedId);
  const objectSource: ManipulationObjectSource & {
    setObjects(next: readonly PageObject[]): void;
  } = {
    getObject: (id) => objects.get(id),
    setObjects(next) {
      objects = new Map(next.map((object) => [object.id, object]));
    },
  };
  const selectionSource: ManipulationSelectionSource & { select(id: string | null): void } = {
    getSelection: () => selection,
    select(id) {
      selection = state(id);
    },
  };
  return { objectSource, selectionSource };
}

function state(selectedId: string | null): SelectionState {
  return Object.freeze({
    selectedObjectId: selectedId,
    selectedObjectIds: Object.freeze(selectedId === null ? [] : [selectedId]),
    selectedObjectType: selectedId === null ? null : "ink",
    selectionTimestamp: selectedId === null ? null : 1,
    selectionVersion: selectedId === null ? 0 : 1,
  });
}
