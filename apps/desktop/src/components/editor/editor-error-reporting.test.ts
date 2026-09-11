import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanvasSurfaceProps } from "@folio/editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import { installEditorHistoryShortcuts } from "../../../../../packages/editor/src/history/editor-history-shortcuts";
import { StrokeBuilder } from "../../../../../packages/ink/src/index";
import type { NotificationInput } from "../notifications/NotificationProvider";

const boundary = vi.hoisted(() => ({
  surface: null as CanvasSurfaceProps | null,
  notify: vi.fn<(notification: NotificationInput) => void>(),
}));

// Render the real shell/workspace/host composition with React's server renderer.
// Canvas mounting, browser-only auxiliary surfaces, and the notification sink
// are substituted; no hook or History behavior is mocked, and no production
// failure hook is needed.
vi.mock("@folio/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@folio/editor")>()),
  CanvasSurface: (props: CanvasSurfaceProps) => {
    boundary.surface = props;
    return null;
  },
}));
vi.mock("../notifications/NotificationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications/NotificationProvider")>()),
  useNotifications: () => ({ notify: boundary.notify }),
}));
vi.mock("./ToolTooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ToolTooltip")>()),
  TooltipLayerProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./ShapeEditingToolbar", () => ({ ShapeEditingToolbar: () => null }));

beforeEach(() => {
  boundary.surface = null;
  boundary.notify.mockClear();
});
afterEach(() => vi.restoreAllMocks());

function renderEditor() {
  renderToStaticMarkup(createElement(App));
  const surface = boundary.surface;
  if (surface === null || surface.onError === undefined) {
    throw new Error("The mounted shell must supply CanvasSurface.onError.");
  }
  return { session: surface.session, onError: surface.onError };
}

function pressHistoryKey(target: EventTarget, shiftKey = false) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key: "z", ctrlKey: true, shiftKey });
  target.dispatchEvent(event);
  return event;
}

describe("editor errors reach shell notifications", () => {
  it("forwards a surface error to one safe non-blocking notification", () => {
    const { onError } = renderEditor();
    onError(new Error('PrivateController: {"path":"C:\\private\\artwork.folio"}'));
    expect(boundary.notify).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn’t complete that edit.",
      tone: "error",
    });
  });

  it.each(["undo", "redo"] as const)(
    "reports keyboard %s failure once without changing the document or History state",
    (operation) => {
      const { session, onError } = renderEditor();
      const original = session.getDocument();
      const successor = original.replacePage(original.firstPage.withName("Edited"));
      const failure = new Error("Private command failure");
      const fail = vi.fn(() => {
        throw failure;
      });
      const history = createEditorHistoryCoordinator({
        documentSession: session,
        onDocumentChange: () => undefined,
        onError,
      });
      const target = new EventTarget();
      const report = vi.fn(onError);
      const uninstall = installEditorHistoryShortcuts({
        controller: history.controller,
        eventTarget: target,
        onError: report,
      });
      try {
        history.controller.executeCommand(
          Object.freeze({
            id: `failing-${operation}`,
            timestamp: "2026-09-11T00:00:00.000Z",
            description: "Edit page",
            execute: () => successor,
            undo: operation === "undo" ? fail : () => original,
            redo: operation === "redo" ? fail : () => successor,
          }),
        );
        if (operation === "redo") pressHistoryKey(target);
        const before = session.getDocument();
        const state = history.controller.getHistoryState();
        expect(boundary.notify).not.toHaveBeenCalled();
        expect(pressHistoryKey(target, operation === "redo").defaultPrevented).toBe(true);
        expect(fail).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]![0]).toMatchObject({ cause: failure });
        expect(boundary.notify).toHaveBeenCalledExactlyOnceWith({
          title: "Couldn’t complete that edit.",
          tone: "error",
        });
        expect(session.getDocument()).toBe(before);
        expect(history.controller.getHistoryState()).toEqual(state);
      } finally {
        uninstall();
        history.destroy();
      }
    },
  );

  it("reports a non-keyboard synchronization error without undoing a successful command", () => {
    const { session, onError } = renderEditor();
    const failure = new Error("Private synchronization detail");
    const report = vi.fn(onError);
    const history = createEditorHistoryCoordinator({
      documentSession: session,
      onDocumentChange: () => {
        throw failure;
      },
      onError: report,
    });
    try {
      history.executePageRename(session.activePage.id, "Committed");
      expect(report).toHaveBeenCalledExactlyOnceWith(failure);
      expect(boundary.notify).toHaveBeenCalledTimes(1);
      expect(session.activePage.name).toBe("Committed");
      expect(history.controller.getHistoryState()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    } finally {
      history.destroy();
    }
  });

  it("does not notify for a committed stroke, keyboard Undo, or Redo", () => {
    const { session, onError } = renderEditor();
    const history = createEditorHistoryCoordinator({
      documentSession: session,
      onDocumentChange: () => undefined,
      onError,
    });
    const target = new EventTarget();
    const uninstall = installEditorHistoryShortcuts({
      controller: history.controller,
      eventTarget: target,
      onError,
    });
    try {
      const builder = new StrokeBuilder({ id: "stroke", timestamp: 0 });
      builder.addPoint({
        x: 10,
        y: 20,
        timestamp: 0,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        pointerType: "pen",
        button: 0,
        buttons: 1,
      });
      const object = session.createStrokeObject(builder.finalize());
      history.executeStroke(object);
      expect(session.page.has(object.id)).toBe(true);
      pressHistoryKey(target);
      expect(session.page.has(object.id)).toBe(false);
      pressHistoryKey(target, true);
      expect(session.page.has(object.id)).toBe(true);
      expect(boundary.notify).not.toHaveBeenCalled();
    } finally {
      uninstall();
      history.destroy();
    }
  });
});
