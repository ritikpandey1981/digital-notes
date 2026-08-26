import type { PageDocument } from "@folio/document";
import type { EditorCommand } from "@folio/history";
import {
  type ResolvedScalarTransformCommandInput,
  type ScalarTransformCommandInput,
  resolveScalarTransformCommandInput,
  transitionScalarTransform,
} from "./object-transform-command";

export interface RotateCommandInput {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly initialRotation: number;
  readonly finalRotation: number;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

class RotateCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #input: ResolvedScalarTransformCommandInput;

  constructor(input: RotateCommandInput) {
    this.#input = resolveScalarTransformCommandInput("rotation", toScalarInput(input));
    this.id = this.#input.id;
    this.timestamp = this.#input.timestamp;
    this.description = this.#input.description;
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#transition(
      document,
      "execute",
      this.#input.initialValue,
      this.#input.finalValue,
      this.#input.expectedObjectModifiedAt,
      this.timestamp,
    );
  }

  undo(document: PageDocument): PageDocument {
    return this.#transition(
      document,
      "undo",
      this.#input.finalValue,
      this.#input.initialValue,
      this.timestamp,
      this.#input.expectedObjectModifiedAt,
    );
  }

  redo(document: PageDocument): PageDocument {
    return this.#transition(
      document,
      "redo",
      this.#input.initialValue,
      this.#input.finalValue,
      this.#input.expectedObjectModifiedAt,
      this.timestamp,
    );
  }

  #transition(
    document: PageDocument,
    operation: "execute" | "undo" | "redo",
    expected: number,
    target: number,
    expectedModifiedAt: string,
    targetModifiedAt: string,
  ): PageDocument {
    return transitionScalarTransform(
      "rotation",
      document,
      this.#input,
      operation,
      expected,
      target,
      expectedModifiedAt,
      targetModifiedAt,
    );
  }
}

export function createRotateCommand(input: RotateCommandInput): EditorCommand<PageDocument> {
  return new RotateCommand(input);
}

function toScalarInput(input: RotateCommandInput): ScalarTransformCommandInput {
  return {
    objectId: input.objectId,
    expectedObjectModifiedAt: input.expectedObjectModifiedAt,
    initialValue: input.initialRotation,
    finalValue: input.finalRotation,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
    ...(input.description === undefined ? {} : { description: input.description }),
  };
}
