import { beforeEach, describe, expect, it } from "vitest";
import { createEffectiveObjectState } from "../EffectiveObjectState";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";

const TIMESTAMP = "2026-08-26T09:00:00.000Z";

function createSession(): InkDocumentSession {
  let objects = 0;
  let pages = 0;
  let layers = 0;
  return new InkDocumentSession({
    createId: () => `object-${(objects += 1)}`,
    createPageId: () => `page-${(pages += 2)}`,
    createLayerId: () => `layer-${(layers += 2)}`,
    now: () => TIMESTAMP,
  });
}

function createCoordinator(session: InkDocumentSession) {
  let tick = 0;
  return createEditorHistoryCoordinator({
    documentSession: session,
    now: () => new Date(Date.parse(TIMESTAMP) + (tick += 1)).toISOString(),
    onDocumentChange: () => undefined,
  });
}

describe("active Layer write eligibility", () => {
  let session: InkDocumentSession;
  let coordinator: ReturnType<typeof createCoordinator>;
  let effective: ReturnType<typeof createEffectiveObjectState>;

  beforeEach(() => {
    session = createSession();
    coordinator = createCoordinator(session);
    effective = createEffectiveObjectState(() => session.page);
  });

  it("permits creation on a visible, unlocked active Layer", () => {
    expect(effective.activeLayerRefusal(session.activeLayerId)).toBeNull();
  });

  it("refuses creation while the active Layer is hidden", () => {
    coordinator.executeLayerPatch(session.activeLayerId, { visible: false });

    expect(effective.activeLayerRefusal(session.activeLayerId)).toBe("hidden");
  });

  it("refuses creation while the active Layer is locked", () => {
    coordinator.executeLayerPatch(session.activeLayerId, { locked: true });

    expect(effective.activeLayerRefusal(session.activeLayerId)).toBe("locked");
  });

  it("reports hidden ahead of locked so the more severe state is surfaced", () => {
    coordinator.executeLayerPatch(session.activeLayerId, { visible: false, locked: true });

    expect(effective.activeLayerRefusal(session.activeLayerId)).toBe("hidden");
  });

  it("permits creation again once the Layer is restored", () => {
    const layerId = session.activeLayerId;
    coordinator.executeLayerPatch(layerId, { visible: false });
    expect(effective.activeLayerRefusal(layerId)).toBe("hidden");

    coordinator.executeLayerPatch(layerId, { visible: true });

    expect(effective.activeLayerRefusal(layerId)).toBeNull();
  });

  it("stays permissive for an identifier that names no Layer", () => {
    // An unknown identifier must not block creation; layer rules only apply to
    // Layers that actually exist on the page.
    expect(effective.activeLayerRefusal("layer-that-does-not-exist")).toBeNull();
  });

  it("keeps existing artwork on a locked Layer selectable but not editable", () => {
    const object = session.createRectangleObject(
      { x: 10, y: 10, width: 40, height: 40 },
      { strokeColor: "#111111", strokeWidth: 2 },
    );
    coordinator.executeObjectCreation(object);
    coordinator.executeLayerPatch(session.activeLayerId, { locked: true });
    const stored = session.collection.lookup(object.id);
    if (stored === undefined) throw new Error("Rectangle was not committed.");

    expect(effective.selectable(stored)).toBe(true);
    expect(effective.editable(stored)).toBe(false);
    expect(effective.erasable(stored)).toBe(false);
    expect(effective.lockedByLayer(stored)).toBe(true);
  });
});
