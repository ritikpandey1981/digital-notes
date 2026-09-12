import { describe, expect, it } from "vitest";
import type { DocumentContentStateId, HistoryDocumentSession } from "../index";
import { createEditorHistoryManager } from "../index";
import { counter, createCounterCommand, type CounterDocument } from "./editor-history-fixtures";

interface IdentitySessionFixture {
  readonly session: HistoryDocumentSession<CounterDocument>;
  readonly stateId: () => DocumentContentStateId;
  readonly minted: () => readonly DocumentContentStateId[];
  readonly failNextReplacement: () => void;
}

/** A session that mints identities the way InkDocumentSession does. */
function createIdentitySession(): IdentitySessionFixture {
  let current = counter(0);
  let ordinal = 0;
  let failing = false;
  const minted: DocumentContentStateId[] = [];
  const mint = (): DocumentContentStateId => {
    const id = `state-${(ordinal += 1)}` as DocumentContentStateId;
    minted.push(id);
    return id;
  };
  let stateId = mint();
  const session: HistoryDocumentSession<CounterDocument> = Object.freeze({
    getDocument: () => current,
    replaceDocument: (document: CounterDocument) => {
      if (document !== current) stateId = mint();
      current = document;
      if (failing) {
        failing = false;
        throw new Error("Document replacement failed after installation.");
      }
    },
    getContentStateId: () => stateId,
    restoreContentStateId: (restored: DocumentContentStateId) => {
      stateId = restored;
    },
  });
  return {
    session,
    stateId: () => stateId,
    minted: () => minted,
    failNextReplacement: () => {
      failing = true;
    },
  };
}

describe("document content state identity", () => {
  it("advances on a durable change and restores the same identity through undo and redo", () => {
    const fixture = createIdentitySession();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const saved = fixture.stateId();

    manager.executeCommand(createCounterCommand({ id: "to-T" }));
    const edited = fixture.stateId();
    expect(edited).not.toBe(saved);

    manager.undo();
    expect(fixture.stateId()).toBe(saved);
    manager.redo();
    expect(fixture.stateId()).toBe(edited);
    manager.undo();
    expect(fixture.stateId()).toBe(saved);
  });

  it("never advances identity for a command that changes nothing or fails", () => {
    const fixture = createIdentitySession();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const before = fixture.stateId();

    manager.executeCommand(createCounterCommand({ id: "no-op", execute: (document) => document }));
    expect(fixture.stateId()).toBe(before);
    expect(manager.getHistoryState().undoDepth).toBe(0);

    expect(() =>
      manager.executeCommand(
        createCounterCommand({
          id: "rejected",
          execute: () => {
            throw new Error("command rejected");
          },
        }),
      ),
    ).toThrowError();
    expect(fixture.stateId()).toBe(before);

    fixture.failNextReplacement();
    expect(() =>
      manager.executeCommand(createCounterCommand({ id: "uninstallable" })),
    ).toThrowError(/uninstallable/);
    expect(fixture.stateId()).toBe(before);
    expect(manager.getHistoryState().undoDepth).toBe(0);
  });

  it("treats one committed transaction as a single identity transition and restores rollback", () => {
    const fixture = createIdentitySession();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const before = fixture.stateId();

    manager.beginTransaction({ id: "rolled-back", timestamp: "2026-07-28T00:00:00.000Z" });
    manager.executeCommand(createCounterCommand({ id: "child-a" }));
    manager.executeCommand(createCounterCommand({ id: "child-b" }));
    expect(fixture.stateId()).not.toBe(before);
    manager.rollbackTransaction();
    expect(fixture.stateId()).toBe(before);

    manager.beginTransaction({ id: "committed", timestamp: "2026-07-28T00:00:00.000Z" });
    manager.executeCommand(createCounterCommand({ id: "child-c" }));
    manager.executeCommand(createCounterCommand({ id: "child-d" }));
    manager.commitTransaction();
    const committed = fixture.stateId();

    expect(manager.getHistoryState().undoDepth).toBe(1);
    manager.undo();
    expect(fixture.stateId()).toBe(before);
    manager.redo();
    expect(fixture.stateId()).toBe(committed);
  });

  it("gives a branch created after undo a unique identity and never reuses a discarded one", () => {
    const fixture = createIdentitySession();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const s = fixture.stateId();
    manager.executeCommand(createCounterCommand({ id: "to-T", delta: 1 }));
    const t = fixture.stateId();
    manager.executeCommand(createCounterCommand({ id: "to-U", delta: 1 }));
    const u = fixture.stateId();
    manager.undo();
    expect(fixture.stateId()).toBe(t);

    manager.executeCommand(createCounterCommand({ id: "to-V", delta: 10 }));
    const v = fixture.stateId();

    expect(manager.getHistoryState().redoDepth).toBe(0);
    expect(new Set([s, t, u, v]).size).toBe(4);
    expect(fixture.minted().filter((id) => id === v)).toHaveLength(1);
    manager.undo();
    expect(fixture.stateId()).toBe(t);
  });

  it("leaves a session without identity support fully functional", () => {
    let current = counter(0);
    const session: HistoryDocumentSession<CounterDocument> = Object.freeze({
      getDocument: () => current,
      replaceDocument: (document: CounterDocument) => {
        current = document;
      },
    });
    const manager = createEditorHistoryManager({ documentSession: session });

    manager.executeCommand(createCounterCommand({ id: "plain" }));
    expect(current.value).toBe(1);
    manager.undo();
    expect(current.value).toBe(0);
    manager.redo();
    expect(current.value).toBe(1);
  });
});
