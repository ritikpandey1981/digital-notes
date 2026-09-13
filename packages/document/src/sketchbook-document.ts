import type { DomainId } from "@folio/domain";
import { LayerMembershipError } from "./errors";
import { createDefaultLayer, Layer } from "./layer";
import { ObjectCollection } from "./object-collection";
import { PageDocument } from "./page-document";
import {
  createPageGeometry,
  DEFAULT_PAGE_GEOMETRY,
  orientPageGeometry,
  pageOrientation,
  type PageGeometry,
  type PageOrientation,
} from "./page-geometry";
import {
  createPagePaper,
  DEFAULT_PAGE_PAPER,
  type PagePaper,
  type PagePaperInput,
} from "./page-paper";
import type { PageObject } from "./types";

export interface PageInput {
  readonly id: DomainId;
  readonly name?: string;
  readonly geometry?: PageGeometry;
  readonly paper?: PagePaper;
  readonly content?: PageDocument;
}

/**
 * One sketchbook page: geometry, paper, and one independent {@link PageDocument}.
 *
 * Artwork is never shared between pages: each page owns its own Layers and its
 * own canonical `ObjectCollection`.
 */
export class Page {
  readonly id: DomainId;
  readonly name: string;
  readonly geometry: PageGeometry;
  readonly paper: PagePaper;
  readonly content: PageDocument;

  constructor(input: PageInput) {
    if (typeof input.id !== "string" || input.id.trim().length === 0) {
      throw new LayerMembershipError("INVALID_PAGE", "Page id must be a non-empty string.");
    }
    const name = input.name ?? "";
    if (typeof name !== "string") {
      throw new LayerMembershipError("INVALID_PAGE", "Page name must be a string.", {
        pageId: input.id,
      });
    }
    this.id = input.id;
    this.name = name;
    this.geometry = createPageGeometry(input.geometry ?? DEFAULT_PAGE_GEOMETRY);
    // Normalised, not adopted. A page that kept the caller's object would keep
    // changing after construction, which every immutable document assumption
    // here depends on not happening.
    this.paper = input.paper === undefined ? DEFAULT_PAGE_PAPER : createPagePaper(input.paper);
    this.content = input.content ?? PageDocument.empty();
    Object.freeze(this);
  }

  get orientation(): PageOrientation {
    return pageOrientation(this.geometry);
  }

  get objectCount(): number {
    return this.content.size;
  }

  withContent(content: PageDocument): Page {
    if (content === this.content) return this;
    return new Page({
      id: this.id,
      name: this.name,
      geometry: this.geometry,
      paper: this.paper,
      content,
    });
  }

  /** Replaces page extent. Artwork geometry is deliberately left untouched. */
  withGeometry(geometry: PageGeometry): Page {
    const next = createPageGeometry(geometry);
    if (next.width === this.geometry.width && next.height === this.geometry.height) return this;
    return new Page({
      id: this.id,
      name: this.name,
      geometry: next,
      paper: this.paper,
      content: this.content,
    });
  }

  withOrientation(orientation: Exclude<PageOrientation, "square">): Page {
    return this.withGeometry(orientPageGeometry(this.geometry, orientation));
  }

  withPaper(paper: PagePaperInput): Page {
    const next = createPagePaper({ ...this.paper, ...paper });
    if (
      next.type === this.paper.type &&
      next.color === this.paper.color &&
      next.spacing === this.paper.spacing
    ) {
      return this;
    }
    return new Page({
      id: this.id,
      name: this.name,
      geometry: this.geometry,
      paper: next,
      content: this.content,
    });
  }

  withName(name: string): Page {
    if (name === this.name) return this;
    return new Page({
      id: this.id,
      name,
      geometry: this.geometry,
      paper: this.paper,
      content: this.content,
    });
  }

  /** True when any artwork extends beyond the current page boundary. */
  hasArtworkOutsideBounds(): boolean {
    return this.content.objects.objects.some(
      (object) =>
        object.bounds.x < 0 ||
        object.bounds.y < 0 ||
        object.bounds.x + object.bounds.width > this.geometry.width ||
        object.bounds.y + object.bounds.height > this.geometry.height,
    );
  }
}

/** Generates fresh identities for one duplicated page. */
export interface PageIdentityFactory {
  readonly createPageId: () => DomainId;
  readonly createLayerId: () => DomainId;
  readonly createObjectId: () => DomainId;
}

interface SketchbookDocumentInput {
  readonly pages: readonly Page[];
}

/**
 * The sketchbook root: an ordered list of independent pages.
 *
 * Page order is array position, first page first, matching the order the user
 * sees in the navigator. There is no separate page index or z-order field.
 * The active page is editor state and deliberately lives outside this value.
 */
export class SketchbookDocument {
  readonly pages: readonly Page[];
  private readonly indexById: ReadonlyMap<string, number>;

  constructor(input: SketchbookDocumentInput) {
    const pages = input.pages;
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new LayerMembershipError("PAGE_REQUIRED", "A sketchbook requires at least one page.");
    }
    const indexes = new Map<string, number>();
    for (const [index, page] of pages.entries()) {
      if (!(page instanceof Page)) {
        throw new LayerMembershipError("INVALID_PAGE", "Sketchbook pages must be Page values.");
      }
      if (indexes.has(page.id)) {
        throw new LayerMembershipError(
          "DUPLICATE_PAGE_ID",
          `Page id '${page.id}' appears more than once.`,
          { pageId: page.id },
        );
      }
      indexes.set(page.id, index);
    }
    this.pages = Object.freeze([...pages]);
    this.indexById = indexes;
    Object.freeze(this);
  }

  static empty(pageId: DomainId = "page-1"): SketchbookDocument {
    return new SketchbookDocument({ pages: [new Page({ id: pageId })] });
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get firstPage(): Page {
    const page = this.pages[0];
    if (page === undefined) {
      throw new LayerMembershipError("PAGE_REQUIRED", "A sketchbook requires at least one page.");
    }
    return page;
  }

  page(pageId: string): Page | undefined {
    const index = this.indexById.get(pageId);
    return index === undefined ? undefined : this.pages[index];
  }

  requirePage(pageId: string): Page {
    const page = this.page(pageId);
    if (page === undefined) {
      throw new LayerMembershipError("PAGE_NOT_FOUND", `Page '${pageId}' was not found.`, {
        pageId,
      });
    }
    return page;
  }

  pageIndex(pageId: string): number {
    const index = this.indexById.get(pageId);
    if (index === undefined) {
      throw new LayerMembershipError("PAGE_NOT_FOUND", `Page '${pageId}' was not found.`, {
        pageId,
      });
    }
    return index;
  }

  /** Resolves the active page id, falling back to the first page. */
  resolveActivePageId(activePageId: string | null | undefined): string {
    if (activePageId !== null && activePageId !== undefined && this.page(activePageId)) {
      return activePageId;
    }
    return this.firstPage.id;
  }

  /**
   * Chooses the page that becomes active after `pageId` is removed.
   *
   * Prefers the next page so deleting forward feels continuous, and falls back
   * to the previous page at the end of the sketchbook.
   */
  neighborPageId(pageId: string): string | null {
    const index = this.pageIndex(pageId);
    return this.pages[index + 1]?.id ?? this.pages[index - 1]?.id ?? null;
  }

  replacePage(page: Page): SketchbookDocument {
    const index = this.pageIndex(page.id);
    if (this.pages[index] === page) return this;
    const pages = [...this.pages];
    pages[index] = page;
    return new SketchbookDocument({ pages });
  }

  insertPage(page: Page, index: number): SketchbookDocument {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.pages.length) {
      throw new LayerMembershipError(
        "INVALID_PAGE_INDEX",
        "Page insertion index is outside the sketchbook.",
        { index, pageCount: this.pages.length },
      );
    }
    if (this.page(page.id) !== undefined) {
      throw new LayerMembershipError("DUPLICATE_PAGE_ID", `Page '${page.id}' already exists.`, {
        pageId: page.id,
      });
    }
    return new SketchbookDocument({
      pages: [...this.pages.slice(0, index), page, ...this.pages.slice(index)],
    });
  }

  removePage(pageId: string): SketchbookDocument {
    this.requirePage(pageId);
    if (this.pages.length === 1) {
      throw new LayerMembershipError(
        "PAGE_REQUIRED",
        "The final remaining page cannot be removed.",
        { pageId },
      );
    }
    return new SketchbookDocument({ pages: this.pages.filter((page) => page.id !== pageId) });
  }

  reorderPages(pageId: string, targetIndex: number): SketchbookDocument {
    const sourceIndex = this.pageIndex(pageId);
    if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.pages.length) {
      throw new LayerMembershipError(
        "INVALID_PAGE_INDEX",
        "Page target index is outside the sketchbook.",
        { pageId, targetIndex, pageCount: this.pages.length },
      );
    }
    if (sourceIndex === targetIndex) return this;
    const pages = [...this.pages];
    const [moved] = pages.splice(sourceIndex, 1);
    if (moved === undefined) {
      throw new LayerMembershipError("PAGE_NOT_FOUND", `Page '${pageId}' was not found.`, {
        pageId,
      });
    }
    pages.splice(targetIndex, 0, moved);
    return new SketchbookDocument({ pages });
  }
}

/**
 * Clones one page with entirely fresh page, Layer, and object identities.
 *
 * Artwork appearance, canonical order, layer state, transforms, and Ink process
 * data are all preserved; only identity changes, so a duplicated page can never
 * collide with its source in a future document format.
 */
export function duplicatePage(page: Page, identity: PageIdentityFactory): Page {
  const objectIdByOriginal = new Map<string, string>();
  const objects: PageObject[] = [];
  for (const object of page.content.objects.objects) {
    const nextId = identity.createObjectId();
    objectIdByOriginal.set(object.id, nextId);
    objects.push(cloneObjectWithId(object, nextId));
  }
  const layers = page.content.layers.map(
    (layer) =>
      new Layer({
        id: identity.createLayerId(),
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        objectIds: layer.objectIds.map((objectId) => {
          const nextId = objectIdByOriginal.get(objectId);
          if (nextId === undefined) {
            throw new LayerMembershipError(
              "ORPHANED_OBJECT",
              `Duplicated layer references unknown object '${objectId}'.`,
              { pageId: page.id, objectId },
            );
          }
          return nextId;
        }),
      }),
  );
  return new Page({
    id: identity.createPageId(),
    name: page.name,
    geometry: page.geometry,
    paper: page.paper,
    content: new PageDocument({ layers, objects: new ObjectCollection(objects) }),
  });
}

/** Creates an empty blank page that inherits only physical geometry from an existing page. */
export function createPageLike(
  source: Page,
  identity: Pick<PageIdentityFactory, "createPageId" | "createLayerId">,
): Page {
  return new Page({
    id: identity.createPageId(),
    geometry: source.geometry,
    paper: DEFAULT_PAGE_PAPER,
    content: new PageDocument({
      layers: [createDefaultLayer(identity.createLayerId())],
      objects: ObjectCollection.empty(),
    }),
  });
}

function cloneObjectWithId(object: PageObject, id: string): PageObject {
  const source = object as PageObject & Record<string, unknown>;
  const constructor = Object.getPrototypeOf(object).constructor as new (
    data: Record<string, unknown>,
  ) => PageObject;
  const common: Record<string, unknown> = {
    id,
    createdAt: object.createdAt,
    modifiedAt: object.modifiedAt,
    visible: object.visible,
    locked: object.locked,
    metadata: object.metadata,
    zIndex: object.zIndex,
    transform: object.transform,
  };
  if (object.type === "ink") {
    return new constructor({
      ...common,
      stroke: source.stroke,
      renderingHints: source.renderingHints,
    });
  }
  return new constructor({ ...common, geometry: source.geometry, style: source.style });
}
