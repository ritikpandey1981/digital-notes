import { describe, expect, it, vi } from "vitest";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { ProjectRuntimeHost, type ProjectRuntime } from "../project-runtime-host";
import { RuntimeActivation, runtimeCallback } from "../runtime-activation";
import { ProjectSession } from "../project-session";
import { EditorSelectionSet } from "../EditorSelectionSet";
import { EditorClipboard } from "../EditorClipboard";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { installEditorHistoryShortcuts } from "../history/editor-history-shortcuts";

function project(name: string) {
  return new ProjectSession(
    createEmptyFolioProject({ title: name, documentId: name, pageId: name }),
  );
}

function key(target: EventTarget) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key: "z", ctrlKey: true });
  target.dispatchEvent(event);
}

function prepare(host: ProjectRuntimeHost, entry: ProjectRuntime, target: EventTarget) {
  const error = vi.fn();
  const activation = new RuntimeActivation(() => host.active === entry, error);
  entry.activation = activation;
  const selection = new EditorSelectionSet();
  const clipboard = new EditorClipboard();
  const history = createEditorHistoryCoordinator({
    documentSession: entry.project.documentSession,
    onDocumentChange: () => undefined,
  });
  const uninstall = installEditorHistoryShortcuts({
    controller: history.controller,
    eventTarget: activation.eventTarget(target),
  });
  const pointer = vi.fn();
  activation.listen(target, "pointerdown", pointer);
  const dispose = vi.fn(() => {
    uninstall();
    clipboard.clear();
    selection.clear();
    history.destroy();
  });
  return {
    activation,
    history,
    selection,
    clipboard,
    pointer,
    dispose,
    error,
    finish: () => activation.finishPreparation(dispose),
  };
}

describe("transactional project runtime host", () => {
  it("prepares inert B while A's exact History, selection, clipboard and viewport remain alive", async () => {
    const target = new EventTarget();
    const a = project("A");
    const host = new ProjectRuntimeHost(a);
    const active = prepare(host, host.active, target);
    host.prepared(host.active, active.finish());
    const session = a.documentSession;
    const object = session.createRectangleObject(
      { x: 1, y: 2, width: 30, height: 40 },
      { strokeColor: "#123456", strokeWidth: 2 },
    );
    active.history.executeObjectCreation(object);
    active.history.executePageRename(session.activePageId, "Temporary name");
    active.history.undo();
    active.selection.replace([object.id]);
    active.clipboard.copy([object]);
    session.rememberViewport("A", { zoom: 2, position: { x: 3, y: 4 }, mode: "manual" });
    const root = session.getDocument();
    const historyState = active.history.controller.getHistoryState();
    expect(historyState).toMatchObject({ undoDepth: 1, redoDepth: 1 });
    const viewport = session.viewportMemory("A");
    const clipboard = active.clipboard.snapshot();
    const projection = vi.fn();
    const replacing = host.replace(project("B"));
    const candidate = host.getSnapshot()[1]!;
    const b = prepare(host, candidate, target);
    b.activation.publish({}, projection);
    target.dispatchEvent(new Event("pointerdown"));
    expect(active.pointer).toHaveBeenCalledTimes(1);
    expect(b.pointer).not.toHaveBeenCalled();
    expect(projection).not.toHaveBeenCalled();
    b.activation.report(new Error("Injected preparation failure"));
    host.prepared(candidate, b.finish());
    expect(await replacing).toMatchObject({ status: "failed" });
    expect(host.active.project).toBe(a);
    expect(a.documentSession).toBe(session);
    expect(session.getDocument()).toBe(root);
    expect(active.history.controller.getHistoryState()).toEqual(historyState);
    expect(active.selection.ids).toEqual([object.id]);
    expect(active.clipboard.snapshot()).toEqual(clipboard);
    expect(session.viewportMemory("A")).toBe(viewport);
    expect(active.dispose).not.toHaveBeenCalled();
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(b.error).not.toHaveBeenCalled();
    key(target);
    expect(active.history.controller.getHistoryState().undoDepth).toBe(0);
    active.activation.dispose();
  });

  it("rolls back failed active-listener installation without destroying A", async () => {
    const target = new EventTarget();
    const host = new ProjectRuntimeHost(project("A"));
    const a = prepare(host, host.active, target);
    host.prepared(host.active, a.finish());
    const result = host.replace(project("B"));
    const candidate = host.getSnapshot()[1]!;
    const b = prepare(host, candidate, target);
    b.activation.onActive(() => {
      throw new Error("listener registration failed");
    });
    host.prepared(candidate, b.finish());
    expect(await result).toMatchObject({ status: "failed" });
    target.dispatchEvent(new Event("pointerdown"));
    expect(a.pointer).toHaveBeenCalledTimes(1);
    expect(b.pointer).not.toHaveBeenCalled();
    expect(a.dispose).not.toHaveBeenCalled();
    expect(b.dispose).toHaveBeenCalledTimes(1);
    a.activation.dispose();
  });

  it("preserves exact A and restores its projections if B's projection hookup throws", async () => {
    const target = new EventTarget();
    const host = new ProjectRuntimeHost(project("A"));
    const a = prepare(host, host.active, target);
    let projection = "";
    const projectionKey = {};
    a.activation.publish(projectionKey, () => {
      projection = "A";
    });
    host.prepared(host.active, a.finish());
    a.history.executePageRename("A", "Existing edit");
    const oldRuntime = host.active;
    const oldRoot = oldRuntime.project.documentSession.getDocument();
    const oldHistory = a.history.controller.getHistoryState();
    const replacement = host.replace(project("B"));
    const candidate = host.getSnapshot()[1]!;
    const b = prepare(host, candidate, target);
    b.activation.publish({}, () => {
      projection = "B";
    });
    b.activation.publish({}, () => {
      throw new Error("projection hookup failed");
    });
    host.prepared(candidate, b.finish());
    expect(await replacement).toMatchObject({ status: "failed" });
    expect(host.active).toBe(oldRuntime);
    expect(projection).toBe("A");
    expect(oldRuntime.project.documentSession.getDocument()).toBe(oldRoot);
    expect(a.history.controller.getHistoryState()).toEqual(oldHistory);
    expect(a.dispose).not.toHaveBeenCalled();
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(b.error).not.toHaveBeenCalled();
    key(target);
    expect(a.history.controller.getHistoryState().undoDepth).toBe(0);
    a.activation.dispose();
  });

  it("hands A to B to C with one shortcut owner, fresh state and no stale publications", async () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const remove = vi.spyOn(target, "removeEventListener");
    const host = new ProjectRuntimeHost(project("A"));
    let current = prepare(host, host.active, target);
    host.prepared(host.active, current.finish());
    const snapshotA = host.active.project.captureSnapshot();
    const encodedA = encodeFolioProject(snapshotA);
    for (const name of ["B", "C"]) {
      current.history.executePageRename(host.active.project.documentSession.activePageId, "Edited");
      const previous = current;
      const stale = vi.fn();
      const result = host.replace(project(name));
      const candidate = host.getSnapshot()[1]!;
      const next = prepare(host, candidate, target);
      const observe = vi.fn(() => expect(host.active).toBe(candidate));
      next.activation.publish({}, observe);
      expect(host.active).not.toBe(candidate);
      host.prepared(candidate, next.finish());
      expect(await result).toMatchObject({ status: "activated", runtime: candidate });
      expect(observe).toHaveBeenCalledTimes(1);
      expect(previous.dispose).toHaveBeenCalledTimes(1);
      previous.activation.publish({}, stale);
      expect(stale).not.toHaveBeenCalled();
      expect(next.history.controller.getHistoryState()).toMatchObject({
        undoDepth: 0,
        redoDepth: 0,
      });
      expect(next.selection.size).toBe(0);
      expect(candidate.project.documentSession.activePageId).toBe(name);
      expect(candidate.project.documentSession.viewportMemory(name)).toBeNull();
      target.dispatchEvent(new Event("pointerdown"));
      expect(next.pointer).toHaveBeenCalledTimes(1);
      next.history.executePageRename(name, "New edit");
      key(target);
      expect(next.history.controller.getHistoryState().undoDepth).toBe(0);
      expect(host.getSnapshot()).toEqual([candidate]);
      expect(add.mock.calls.length - remove.mock.calls.length).toBe(2);
      current = next;
    }
    expect(encodeFolioProject(snapshotA)).toBe(encodedA);
    current.activation.dispose();
    expect(add.mock.calls.length).toBe(remove.mock.calls.length);
  });

  it("coalesces candidate projections and reads the latest callback at activation", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const source = { current: first };
    const scope = new RuntimeActivation(() => true, vi.fn());
    const bound = runtimeCallback(scope, source);
    bound.current("old");
    bound.current("new");
    source.current = latest;
    scope.finishPreparation(() => undefined);
    scope.arm();
    scope.commit();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith("new");
    scope.dispose();
    bound.current("stale");
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("keeps candidate and active error channels separate", () => {
    const notify = vi.fn();
    const scope = new RuntimeActivation(() => true, notify);
    scope.finishPreparation(() => undefined);
    scope.arm();
    scope.commit();
    const error = new Error("active command error");
    scope.report(error);
    expect(notify).toHaveBeenCalledExactlyOnceWith(error);
    scope.dispose();
    scope.report(new Error("late error"));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("refuses overlapping replacements and replacement while the host operation gate is closed", async () => {
    const host = new ProjectRuntimeHost(project("A"), () => false);
    expect(await host.replace(project("B"))).toEqual({ status: "busy" });
    const other = new ProjectRuntimeHost(project("A"));
    const disconnect = other.connect();
    const pending = other.replace(project("B"));
    expect(await other.replace(project("C"))).toEqual({ status: "busy" });
    disconnect();
    expect(await pending).toMatchObject({ status: "failed" });
    expect(await other.replace(project("D"))).toMatchObject({ status: "failed" });
  });
});
