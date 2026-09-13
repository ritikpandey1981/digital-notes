import { ProjectSession, ProjectRuntimeHost, type ProjectRuntime } from "@folio/editor";
import { createEmptyFolioProject } from "@folio/persistence/project";
import { describe, expect, it, vi } from "vitest";
import { RuntimeActivation } from "../../../../../../packages/editor/src/runtime-activation";
import { createRuntimeScopedAction } from "../runtime-scoped-action";

function setup() {
  const a = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const host = new ProjectRuntimeHost(a);
  const prepare = (entry: ProjectRuntime) => {
    const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
    host.attach(entry, scope);
    host.prepared(entry, scope.finishPreparation(vi.fn()));
  };
  prepare(host.active);
  const unsubscribe = host.subscribe(() => {
    const candidate = host.getSnapshot()[1];
    if (candidate && candidate.activation === null) prepare(candidate);
  });
  const original = host.active;
  const undo = vi.fn();
  const action = createRuntimeScopedAction(host, original, undo);
  const replace = async (documentId: string) => {
    const project = new ProjectSession(
      createEmptyFolioProject({ documentId, title: documentId, pageId: `page-${documentId}` }),
    );
    return host.replace(project);
  };
  return {
    host,
    original,
    undo,
    action,
    replace,
    cleanup: () => {
      unsubscribe();
      host.active.activation?.dispose();
    },
  };
}

describe("an action offered by a notification belongs to one project", () => {
  it("works while the project it came from is still open", () => {
    const s = setup();
    try {
      s.action();
      expect(s.undo).toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });

  it("does nothing once another project has replaced it", async () => {
    const s = setup();
    try {
      expect((await s.replace("B")).status).toBe("activated");
      expect(s.host.active).not.toBe(s.original);

      // The notification is still on screen; its Undo is about a drawing that
      // is no longer open, and must not reach the History that was destroyed
      // with it.
      s.action();
      expect(s.undo, "a retired runtime's action still ran").not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("leaves the current project's own actions working", async () => {
    const s = setup();
    try {
      await s.replace("B");
      const current = s.host.active;
      const undoCurrent = vi.fn();
      const currentAction = createRuntimeScopedAction(s.host, current, undoCurrent);

      s.action();
      currentAction();

      expect(s.undo).not.toHaveBeenCalled();
      expect(undoCurrent, "the live project's action was disabled too").toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });

  it("stays retired through any number of later replacements", async () => {
    const s = setup();
    try {
      await s.replace("B");
      await s.replace("C");
      s.action();
      expect(s.undo).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });
});
