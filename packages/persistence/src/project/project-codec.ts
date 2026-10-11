import {
  Layer,
  ObjectCollection,
  Page,
  PageDocument,
  SketchbookDocument,
  createPageGeometry,
  createPagePaper,
  type PageGeometry,
  type PagePaper,
  type PaperType,
} from "@folio/document";
import { FolioProjectCodecError } from "./project-errors";
import {
  decodePageObject,
  encodePageObject,
  type SerializedProjectPageObject,
} from "./page-object-codec";
import {
  CURRENT_FOLIO_PROJECT_VERSION,
  type CreateEmptyFolioProjectOptions,
  type FolioProjectMetadata,
  type FolioProjectSnapshot,
} from "./project-types";
import {
  PROJECT_LIMITS,
  addObjectCount,
  assertEncodableProjectTree,
  assertEncodedOutputWithinLimits,
  assertExactKeys,
  assertInputWithinLimits,
  assertMaximumCount,
  constructOrFail,
  createResourceBudget,
  expectArray,
  expectBoolean,
  expectFiniteNumber,
  expectId,
  expectIsoTimestamp,
  expectRecord,
  expectString,
  fail,
  type ProjectResourceBudget,
} from "./project-validation";

interface SerializedProjectLayer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly objectIds: readonly string[];
}

interface SerializedProjectPage {
  readonly id: string;
  readonly name: string;
  readonly geometry: PageGeometry;
  readonly paper: PagePaper;
  readonly content: Readonly<{
    layers: readonly SerializedProjectLayer[];
    objects: readonly SerializedProjectPageObject[];
  }>;
}

interface SerializedFolioProjectV1 {
  readonly format: "folio-project";
  readonly formatVersion: 1;
  readonly metadata: FolioProjectMetadata;
  readonly sketchbook: Readonly<{
    pages: readonly SerializedProjectPage[];
  }>;
}

interface IdentityRegistry {
  readonly pageIds: Set<string>;
  readonly layerIds: Set<string>;
  readonly objectIds: Set<string>;
}

const DEFAULT_PROJECT_TITLE = "Untitled Sketch";

/** Encodes project content as deterministic, versioned, browser-safe JSON. */
export function encodeFolioProject(project: FolioProjectSnapshot): string {
  const serialized = buildFolioProjectTree(project);
  // One walk of the finished tree, before any text exists: it proves the
  // nesting the decoder will accept and that every value is one JSON can
  // actually carry. Both used to be separate full passes, and the second of
  // them could only run after the values it was looking for had already been
  // dropped by `JSON.stringify`.
  assertEncodableProjectTree(serialized);
  const output = constructOrFail(
    "INVALID_PROJECT",
    "$",
    "Folio project could not be encoded as JSON.",
    () => `${JSON.stringify(serialized, null, 2)}
`,
  );
  assertEncodedOutputWithinLimits(output);
  return output;
}

/**
 * Builds the document the encoder is about to write, and nothing else.
 *
 * Split out from {@link encodeFolioProject} so the two halves of a recovery
 * capture can be measured separately: this half is the model's own cost, and
 * what follows it is the cost of turning a tree into text. Both were one number
 * while the expensive half was a validation pass nobody could see.
 */
export function buildFolioProjectTree(project: FolioProjectSnapshot): SerializedFolioProjectV1 {
  const projectRecord = expectRecord(
    project,
    "$",
    "INVALID_PROJECT",
    "Folio project snapshot must be a plain object.",
  );
  if (!Object.prototype.hasOwnProperty.call(projectRecord, "metadata")) {
    fail("INVALID_METADATA", "$.metadata", "Project metadata is missing.");
  }
  assertExactKeys(projectRecord, ["metadata", "sketchbook"], [], "$", "INVALID_PROJECT");
  const budget = createResourceBudget();
  const metadata = parseMetadata(projectRecord.metadata, "$.metadata");
  const sketchbook = projectRecord.sketchbook;
  if (!(sketchbook instanceof SketchbookDocument)) {
    fail(
      "INVALID_PROJECT",
      "$.sketchbook",
      "Folio project snapshot must contain a live SketchbookDocument instance.",
    );
  }
  assertMaximumCount(
    sketchbook.pages.length,
    PROJECT_LIMITS.pages,
    "$.sketchbook.pages",
    "Page count",
  );
  const identities = createIdentityRegistry();
  // format, formatVersion, metadata, sketchbook: already canonical.
  return {
    format: "folio-project",
    formatVersion: CURRENT_FOLIO_PROJECT_VERSION,
    metadata,
    sketchbook: {
      pages: sketchbook.pages.map((page, index) => encodePage(page, index, budget, identities)),
    },
  };
}

/** Decodes one v1 document into real validated immutable Folio model instances. */
export function decodeFolioProject(input: string): FolioProjectSnapshot {
  assertInputWithinLimits(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch (error) {
    throw new FolioProjectCodecError("INVALID_PROJECT", "Folio project contains invalid JSON.", {
      path: "$",
      cause: error,
    });
  }
  const root = expectRecord(parsed, "$", "INVALID_PROJECT", "Folio project must be an object.");
  if (!Object.prototype.hasOwnProperty.call(root, "format")) {
    fail("INVALID_PROJECT", "$.format", "Folio project format discriminator is missing.");
  }
  if (root.format !== "folio-project") {
    fail("INVALID_PROJECT", "$.format", "Folio project format discriminator is invalid.");
  }
  if (!Object.prototype.hasOwnProperty.call(root, "formatVersion")) {
    fail("INVALID_PROJECT", "$.formatVersion", "Folio project format version is missing.");
  }
  if (!Number.isSafeInteger(root.formatVersion) || (root.formatVersion as number) < 1) {
    fail(
      "INVALID_PROJECT",
      "$.formatVersion",
      "Folio project format version must be a positive integer.",
    );
  }
  if (root.formatVersion !== CURRENT_FOLIO_PROJECT_VERSION) {
    fail(
      "UNSUPPORTED_VERSION",
      "$.formatVersion",
      `Folio project version ${String(root.formatVersion)} is not supported.`,
      { received: root.formatVersion, supported: CURRENT_FOLIO_PROJECT_VERSION },
    );
  }
  if (!Object.prototype.hasOwnProperty.call(root, "metadata")) {
    fail("INVALID_METADATA", "$.metadata", "Project metadata is missing.");
  }
  assertExactKeys(
    root,
    ["format", "formatVersion", "metadata", "sketchbook"],
    [],
    "$",
    "INVALID_PROJECT",
  );
  const metadata = parseMetadata(root.metadata, "$.metadata");
  const sketchbookRecord = expectRecord(
    root.sketchbook,
    "$.sketchbook",
    "INVALID_PROJECT",
    "Sketchbook payload must be an object.",
  );
  if (!Object.prototype.hasOwnProperty.call(sketchbookRecord, "pages")) {
    fail("INVALID_PAGE", "$.sketchbook.pages", "Sketchbook pages are missing.");
  }
  assertExactKeys(sketchbookRecord, ["pages"], [], "$.sketchbook", "INVALID_PROJECT");
  const pageValues = expectArray(sketchbookRecord.pages, "$.sketchbook.pages", "INVALID_PAGE");
  if (pageValues.length === 0) {
    fail("INVALID_PAGE", "$.sketchbook.pages", "A Folio sketchbook requires at least one page.");
  }
  assertMaximumCount(pageValues.length, PROJECT_LIMITS.pages, "$.sketchbook.pages", "Page count");
  const budget = createResourceBudget();
  const identities = createIdentityRegistry();
  const pages = pageValues.map((page, index) => decodePage(page, index, budget, identities));
  const sketchbook = constructOrFail(
    "INVALID_PROJECT",
    "$.sketchbook",
    "Sketchbook failed live document validation.",
    () => new SketchbookDocument({ pages }),
  );
  return Object.freeze({ metadata: Object.freeze({ ...metadata }), sketchbook });
}

/** Creates project content for New without installing it into any editor session. */
export function createEmptyFolioProject(
  options: CreateEmptyFolioProjectOptions = {},
): FolioProjectSnapshot {
  const documentId = options.documentId ?? (options.createDocumentId ?? defaultDocumentId)();
  const createdAt = options.createdAt ?? (options.now ?? (() => new Date().toISOString()))();
  const metadata = parseMetadata(
    {
      documentId,
      title: options.title ?? DEFAULT_PROJECT_TITLE,
      createdAt,
    },
    "$.metadata",
  );
  const pageId = expectId(options.pageId ?? "page-1", "$.sketchbook.pages[0].id", "INVALID_PAGE");
  return Object.freeze({
    metadata: Object.freeze({ ...metadata }),
    sketchbook: SketchbookDocument.empty(pageId),
  });
}

function encodePage(
  page: Page,
  index: number,
  budget: ProjectResourceBudget,
  identities: IdentityRegistry,
): SerializedProjectPage {
  const path = `$.sketchbook.pages[${index}]`;
  if (!(page instanceof Page))
    fail("INVALID_PAGE", path, "Sketchbook pages must be Page instances.");
  const id = expectId(page.id, `${path}.id`, "INVALID_PAGE");
  registerIdentity(identities.pageIds, id, `${path}.id`, "page", "INVALID_PAGE");
  const name = expectString(page.name, `${path}.name`, "INVALID_PAGE", {
    maximumLength: PROJECT_LIMITS.nameLength,
  });
  const geometry = parsePageGeometry(page.geometry, `${path}.geometry`);
  const paper = parsePagePaper(page.paper, `${path}.paper`);
  if (!(page.content instanceof PageDocument)) {
    fail("INVALID_PAGE", `${path}.content`, "Page content must be a PageDocument instance.");
  }
  if (!(page.content.objects instanceof ObjectCollection)) {
    fail(
      "INVALID_PAGE",
      `${path}.content.objects`,
      "Page content must own an ObjectCollection instance.",
    );
  }
  const objects = page.content.objects.objects;
  const layers = page.content.layers;
  assertMaximumCount(
    layers.length,
    PROJECT_LIMITS.layersPerPage,
    `${path}.content.layers`,
    "Layers per page",
  );
  assertMaximumCount(
    objects.length,
    PROJECT_LIMITS.objectsPerPage,
    `${path}.content.objects`,
    "Objects per page",
  );
  addObjectCount(budget, objects.length, `${path}.content.objects`);
  const encodedLayers = layers.map((layer, layerIndex) =>
    encodeLayer(layer, `${path}.content.layers[${layerIndex}]`, identities),
  );
  const encodedObjects = objects.map((object, objectIndex) => {
    registerIdentity(
      identities.objectIds,
      object.id,
      `${path}.content.objects[${objectIndex}].id`,
      "object",
      "INVALID_OBJECT",
    );
    return encodePageObject(object, objectIndex, `${path}.content.objects[${objectIndex}]`, budget);
  });
  assertMembership(encodedLayers, encodedObjects, `${path}.content`);
  return {
    content: { layers: encodedLayers, objects: encodedObjects },
    // The model's own geometry and paper carry their keys in the order the
    // document package builds them, which is not this format's order.
    geometry: { height: geometry.height, width: geometry.width },
    id,
    name,
    paper:
      paper.spacing === undefined
        ? { color: paper.color, type: paper.type }
        : { color: paper.color, spacing: paper.spacing, type: paper.type },
  };
}

function decodePage(
  value: unknown,
  index: number,
  budget: ProjectResourceBudget,
  identities: IdentityRegistry,
): Page {
  const path = `$.sketchbook.pages[${index}]`;
  const record = expectRecord(value, path, "INVALID_PAGE", "Page must be an object.");
  assertExactKeys(record, ["id", "name", "geometry", "paper", "content"], [], path, "INVALID_PAGE");
  const id = expectId(record.id, `${path}.id`, "INVALID_PAGE");
  registerIdentity(identities.pageIds, id, `${path}.id`, "page", "INVALID_PAGE");
  const contentRecord = expectRecord(
    record.content,
    `${path}.content`,
    "INVALID_PAGE",
    "Page content must be an object.",
  );
  assertExactKeys(contentRecord, ["layers", "objects"], [], `${path}.content`, "INVALID_PAGE");
  const layerValues = expectArray(contentRecord.layers, `${path}.content.layers`, "INVALID_LAYER");
  if (layerValues.length === 0) {
    fail("INVALID_LAYER", `${path}.content.layers`, "A page requires at least one Layer.");
  }
  assertMaximumCount(
    layerValues.length,
    PROJECT_LIMITS.layersPerPage,
    `${path}.content.layers`,
    "Layers per page",
  );
  const objectValues = expectArray(
    contentRecord.objects,
    `${path}.content.objects`,
    "INVALID_OBJECT",
  );
  assertMaximumCount(
    objectValues.length,
    PROJECT_LIMITS.objectsPerPage,
    `${path}.content.objects`,
    "Objects per page",
  );
  addObjectCount(budget, objectValues.length, `${path}.content.objects`);
  const layers = layerValues.map((layer, layerIndex) =>
    decodeLayer(layer, `${path}.content.layers[${layerIndex}]`, identities),
  );
  const objects = objectValues.map((object, objectIndex) => {
    const decoded = decodePageObject(
      object,
      objectIndex,
      `${path}.content.objects[${objectIndex}]`,
      budget,
    );
    registerIdentity(
      identities.objectIds,
      decoded.id,
      `${path}.content.objects[${objectIndex}].id`,
      "object",
      "INVALID_OBJECT",
    );
    return decoded;
  });
  assertMembership(layers, objects, `${path}.content`);
  const objectCollection = constructOrFail(
    "INVALID_OBJECT",
    `${path}.content.objects`,
    "Canonical objects failed ObjectCollection validation.",
    () => new ObjectCollection(objects),
  );
  const content = constructOrFail(
    "INVALID_LAYER",
    `${path}.content`,
    "Layer membership disagrees with canonical ObjectCollection order.",
    () => new PageDocument({ layers, objects: objectCollection }),
  );
  return constructOrFail(
    "INVALID_PAGE",
    path,
    "Page failed live document validation.",
    () =>
      new Page({
        id,
        name: expectString(record.name, `${path}.name`, "INVALID_PAGE", {
          maximumLength: PROJECT_LIMITS.nameLength,
        }),
        geometry: parsePageGeometry(record.geometry, `${path}.geometry`),
        paper: parsePagePaper(record.paper, `${path}.paper`),
        content,
      }),
  );
}

function encodeLayer(
  layer: Layer,
  path: string,
  identities: IdentityRegistry,
): SerializedProjectLayer {
  if (!(layer instanceof Layer))
    fail("INVALID_LAYER", path, "Page layers must be Layer instances.");
  const id = expectId(layer.id, `${path}.id`, "INVALID_LAYER");
  registerIdentity(identities.layerIds, id, `${path}.id`, "Layer", "INVALID_LAYER");
  return {
    id,
    locked: expectBoolean(layer.locked, `${path}.locked`, "INVALID_LAYER"),
    name: expectString(layer.name, `${path}.name`, "INVALID_LAYER", {
      nonBlank: true,
      maximumLength: PROJECT_LIMITS.nameLength,
    }),
    objectIds: layer.objectIds.map((objectId, index) =>
      expectId(objectId, `${path}.objectIds[${index}]`, "INVALID_LAYER"),
    ),
    opacity: parseLayerOpacity(layer.opacity, `${path}.opacity`),
    visible: expectBoolean(layer.visible, `${path}.visible`, "INVALID_LAYER"),
  };
}

function decodeLayer(value: unknown, path: string, identities: IdentityRegistry): Layer {
  const record = expectRecord(value, path, "INVALID_LAYER", "Layer must be an object.");
  assertExactKeys(
    record,
    ["id", "name", "visible", "locked", "opacity", "objectIds"],
    [],
    path,
    "INVALID_LAYER",
  );
  const id = expectId(record.id, `${path}.id`, "INVALID_LAYER");
  registerIdentity(identities.layerIds, id, `${path}.id`, "Layer", "INVALID_LAYER");
  const objectIds = expectArray(record.objectIds, `${path}.objectIds`, "INVALID_LAYER").map(
    (objectId, index) => expectId(objectId, `${path}.objectIds[${index}]`, "INVALID_LAYER"),
  );
  return constructOrFail(
    "INVALID_LAYER",
    path,
    "Layer failed live document validation.",
    () =>
      new Layer({
        id,
        name: expectString(record.name, `${path}.name`, "INVALID_LAYER", {
          nonBlank: true,
          maximumLength: PROJECT_LIMITS.nameLength,
        }),
        visible: expectBoolean(record.visible, `${path}.visible`, "INVALID_LAYER"),
        locked: expectBoolean(record.locked, `${path}.locked`, "INVALID_LAYER"),
        opacity: parseLayerOpacity(record.opacity, `${path}.opacity`),
        objectIds,
      }),
  );
}

function parseMetadata(value: unknown, path: string): FolioProjectMetadata {
  const record = expectRecord(
    value,
    path,
    "INVALID_METADATA",
    "Project metadata must be an object.",
  );
  assertExactKeys(record, ["documentId", "title", "createdAt"], [], path, "INVALID_METADATA");
  return {
    createdAt: expectIsoTimestamp(record.createdAt, `${path}.createdAt`, "INVALID_METADATA"),
    documentId: expectId(record.documentId, `${path}.documentId`, "INVALID_METADATA"),
    title: expectString(record.title, `${path}.title`, "INVALID_METADATA", {
      nonBlank: true,
      maximumLength: PROJECT_LIMITS.titleLength,
    }),
  };
}

function parsePageGeometry(value: unknown, path: string): PageGeometry {
  const record = expectRecord(value, path, "INVALID_PAGE", "Page geometry must be an object.");
  assertExactKeys(record, ["width", "height"], [], path, "INVALID_PAGE");
  const geometry = {
    width: expectFiniteNumber(record.width, `${path}.width`, "INVALID_PAGE"),
    height: expectFiniteNumber(record.height, `${path}.height`, "INVALID_PAGE"),
  };
  return constructOrFail("INVALID_PAGE", path, "Page geometry failed document validation.", () =>
    createPageGeometry(geometry),
  );
}

function parsePagePaper(value: unknown, path: string): PagePaper {
  const record = expectRecord(value, path, "INVALID_PAGE", "Page paper must be an object.");
  const type = record.type;
  if (
    type !== "blank" &&
    type !== "ruled" &&
    type !== "grid" &&
    type !== "dotted" &&
    type !== "isometric"
  ) {
    fail("INVALID_PAGE", `${path}.type`, "Page paper type is not supported.");
  }
  const paperType = type as PaperType;
  assertExactKeys(
    record,
    paperType === "blank" ? ["type", "color"] : ["type", "color", "spacing"],
    [],
    path,
    "INVALID_PAGE",
  );
  const color = expectString(record.color, `${path}.color`, "INVALID_PAGE");
  if (!/^#[0-9a-f]{6}$/u.test(color)) {
    fail("INVALID_PAGE", `${path}.color`, "Paper color must use canonical lowercase RGB hex.");
  }
  const input =
    paperType === "blank"
      ? { type: paperType, color }
      : {
          type: paperType,
          color,
          spacing: expectFiniteNumber(record.spacing, `${path}.spacing`, "INVALID_PAGE"),
        };
  return constructOrFail("INVALID_PAGE", path, "Page paper failed document validation.", () =>
    createPagePaper(input),
  );
}

function parseLayerOpacity(value: unknown, path: string): number {
  const opacity = expectFiniteNumber(value, path, "INVALID_LAYER");
  if (opacity < 0 || opacity > 1) {
    fail("INVALID_LAYER", path, "Layer opacity must be between zero and one.");
  }
  return opacity;
}

function assertMembership(
  layers: readonly Readonly<{ id: string; objectIds: readonly string[] }>[],
  objects: readonly Readonly<{ id: string }>[],
  path: string,
): void {
  const objectIds = new Set(objects.map((object) => object.id));
  const claimed = new Set<string>();
  let cursor = 0;
  for (const [layerIndex, layer] of layers.entries()) {
    for (const [membershipIndex, objectId] of layer.objectIds.entries()) {
      const membershipPath = `${path}.layers[${layerIndex}].objectIds[${membershipIndex}]`;
      if (!objectIds.has(objectId)) {
        fail("INVALID_LAYER", membershipPath, `Layer references missing object '${objectId}'.`);
      }
      if (claimed.has(objectId)) {
        fail("INVALID_LAYER", membershipPath, `Object '${objectId}' belongs to multiple Layers.`);
      }
      claimed.add(objectId);
      const canonical = objects[cursor];
      if (canonical?.id !== objectId) {
        fail(
          "INVALID_LAYER",
          membershipPath,
          "Layer membership order disagrees with canonical ObjectCollection order.",
          { expectedObjectId: canonical?.id ?? null, receivedObjectId: objectId },
        );
      }
      cursor += 1;
    }
  }
  if (cursor !== objects.length) {
    const orphan = objects[cursor];
    fail(
      "INVALID_LAYER",
      `${path}.objects[${cursor}]`,
      `Canonical object '${orphan?.id ?? "unknown"}' has no owning Layer.`,
    );
  }
}

function registerIdentity(
  set: Set<string>,
  id: string,
  path: string,
  label: string,
  code: "INVALID_PAGE" | "INVALID_LAYER" | "INVALID_OBJECT",
): void {
  if (set.has(id)) fail(code, path, `Duplicate ${label} id '${id}'.`);
  set.add(id);
}

function createIdentityRegistry(): IdentityRegistry {
  return { pageIds: new Set(), layerIds: new Set(), objectIds: new Set() };
}

function defaultDocumentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
