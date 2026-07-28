import type { EditorCommand, HistoryDocumentSession } from "../index";

export interface CounterDocument {
  readonly value: number;
}

interface CounterCommandOptions {
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
  readonly delta?: number;
  readonly execute?: (document: CounterDocument) => CounterDocument;
  readonly undo?: (document: CounterDocument) => CounterDocument;
  readonly redo?: (document: CounterDocument) => CounterDocument;
}

export interface DocumentSessionFixture {
  readonly session: HistoryDocumentSession<CounterDocument>;
  readonly current: CounterDocument;
  readonly replacements: readonly CounterDocument[];
  readonly failNextReplacement: (timing: "after" | "before") => void;
}

export function counter(value: number): CounterDocument {
  return Object.freeze({ value });
}

export function createCounterCommand(
  options: CounterCommandOptions = {},
): EditorCommand<CounterDocument> {
  const delta = options.delta ?? 1;
  return Object.freeze({
    id: options.id ?? `counter-${delta}`,
    timestamp: options.timestamp ?? "2026-07-28T00:00:00.000Z",
    description: options.description ?? `Change counter by ${delta}`,
    execute: options.execute ?? ((document: CounterDocument) => counter(document.value + delta)),
    undo: options.undo ?? ((document: CounterDocument) => counter(document.value - delta)),
    redo: options.redo ?? ((document: CounterDocument) => counter(document.value + delta)),
  });
}

export function createDocumentSessionFixture(
  initial: CounterDocument = counter(0),
): DocumentSessionFixture {
  let current = initial;
  let failureTiming: "after" | "before" | null = null;
  const replacements: CounterDocument[] = [];
  const session: HistoryDocumentSession<CounterDocument> = Object.freeze({
    getDocument: () => current,
    replaceDocument: (document: CounterDocument) => {
      if (failureTiming === "before") {
        failureTiming = null;
        throw new Error("Document replacement failed before installation.");
      }
      current = document;
      replacements.push(document);
      if (failureTiming === "after") {
        failureTiming = null;
        throw new Error("Document replacement failed after installation.");
      }
    },
  });

  return {
    session,
    get current() {
      return current;
    },
    get replacements() {
      return replacements;
    },
    failNextReplacement(timing) {
      failureTiming = timing;
    },
  };
}
