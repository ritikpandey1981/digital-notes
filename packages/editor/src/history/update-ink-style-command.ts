import { InkObject, ObjectFactory, PageDocument } from "@folio/document";
import type { EditorCommand } from "@folio/history";
import { applyInkStyle, type InkStylePatch } from "../InkStyleEdit";

export interface UpdateInkStyleCommandInput {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly initialStyle: InkStylePatch;
  readonly finalStyle: InkStylePatch;
  readonly timestamp: string;
  readonly id?: string;
  readonly description?: string;
}

function requirePage(document: PageDocument): PageDocument {
  if (!(document instanceof PageDocument)) {
    throw new TypeError("UpdateInkStyleCommand requires a PageDocument.");
  }
  return document;
}

class UpdateInkStyleCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #objectId: string;
  readonly #initialStyle: InkStylePatch;
  readonly #finalStyle: InkStylePatch;
  readonly #factory: ObjectFactory;

  constructor(input: UpdateInkStyleCommandInput) {
    if (typeof input.objectId !== "string" || input.objectId.trim().length === 0) {
      throw new TypeError("UpdateInkStyleCommand requires an object id.");
    }
    this.id = input.id ?? `update-ink-style-${input.objectId}-${input.timestamp}`;
    this.timestamp = input.timestamp;
    this.description = input.description ?? "Update ink appearance";
    this.#objectId = input.objectId;
    this.#initialStyle = Object.freeze({ ...input.initialStyle });
    this.#finalStyle = Object.freeze({ ...input.finalStyle });
    this.#factory = new ObjectFactory();
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#apply(document, this.#finalStyle);
  }

  undo(document: PageDocument): PageDocument {
    return this.#apply(document, this.#initialStyle);
  }

  redo(document: PageDocument): PageDocument {
    return this.#apply(document, this.#finalStyle);
  }

  #apply(document: PageDocument, style: InkStylePatch): PageDocument {
    const current = requirePage(document);
    const object = current.lookup(this.#objectId);
    if (!(object instanceof InkObject)) {
      throw new Error(`Ink object '${this.#objectId}' was not found.`);
    }
    if (!object.visible || object.locked) {
      throw new Error(`Ink object '${this.#objectId}' cannot be styled.`);
    }
    return current.replace(applyInkStyle(object, style, this.#factory, this.timestamp));
  }
}

export function createUpdateInkStyleCommand(
  input: UpdateInkStyleCommandInput,
): EditorCommand<PageDocument> {
  return new UpdateInkStyleCommand(input);
}
