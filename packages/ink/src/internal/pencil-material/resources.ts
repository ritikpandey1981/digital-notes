import { InkError } from "../../errors";
import { clampUnit, materialHash, materialNoise } from "./material-hash";

/**
 * The built-in material resources a dry-media strategy deposits through.
 *
 * Two questions this module answers, and nothing else. **What is a resource?**
 * A versioned, immutable, Folio-owned grayscale field, generated from the
 * pinned primitives in {@link ./material-hash.ts} rather than loaded from a
 * file, so a build carries it without carrying an asset and a reopen cannot
 * find a different one. **Who may name one?** A strategy version, and only a
 * strategy version -- see {@link pencilMaterialResources}.
 *
 * Deliberately absent, and absent on purpose rather than by omission:
 * user-imported textures, an asset manager, a loader, a path, a URL, a cache
 * eviction policy, and any way for durable artwork to name a resource directly.
 * Each of those is a durable promise, and a durable promise with nothing behind
 * it is exactly the mistake `StrokeStyle.brushTextureId` already made once.
 */

/**
 * Every built-in material resource this build contains.
 *
 * Entries are only ever added. Removing one would stop artwork drawn with it
 * from reproducing, and changing what one contains would silently rewrite that
 * artwork -- which is what the `.v1` in each id is for.
 */
export type MaterialResourceId = "folio.graphite.hb-tip.v1" | "folio.paper.graphite-tooth.v1";

/** One square grayscale field, addressed by the material equations. */
export interface MaterialResource {
  readonly id: MaterialResourceId;
  /** Edge length in samples. The field is `size * size` bytes. */
  readonly size: number;
  readonly samples: Uint8Array;
}

/** The pair one dry-media strategy version deposits through. */
export interface PencilMaterialResources {
  readonly nib: MaterialResource;
  readonly paper: MaterialResource;
}

const NIB_SIZE = 128;
const PAPER_SIZE = 256;

/**
 * Seeds for the generated fields, pinned by the resource versions above.
 *
 * They are separate numbers rather than one, because the two fields are
 * generated independently and a shared seed would correlate the nib's own
 * variation with the sheet it lands on.
 */
const NIB_VARIATION_SEED = 29;
const PAPER_SEED = 91;

/**
 * The nib: a circular tip with a soft rim and a little internal variation.
 *
 * Circular, because a graphite tip worn in by use is round and because a tap
 * has to leave the tip rather than a shape. The rim falls off over the last
 * fifth of the radius, which is what makes a terminal read as graphite running
 * out rather than as a disc being stamped; the gentle multiplicative variation
 * on top of it stops the mask from being perfectly radially symmetric, which
 * the eye finds immediately at a broad size.
 */
const NIB_EDGE_FALLOFF = 0.19;
const NIB_VARIATION_FLOOR = 0.91;
const NIB_VARIATION_RANGE = 0.09;
const NIB_VARIATION_CELL = 8;

function generateNib(): Uint8Array {
  const samples = new Uint8Array(NIB_SIZE * NIB_SIZE);
  const half = NIB_SIZE / 2;
  for (let y = 0; y < NIB_SIZE; y += 1) {
    for (let x = 0; x < NIB_SIZE; x += 1) {
      const radius = Math.hypot((x + 0.5) / half - 1, (y + 0.5) / half - 1);
      const edge = clampUnit((1 - radius) / NIB_EDGE_FALLOFF);
      const variation =
        NIB_VARIATION_FLOOR +
        NIB_VARIATION_RANGE *
          materialNoise(x / NIB_VARIATION_CELL, y / NIB_VARIATION_CELL, NIB_VARIATION_SEED);
      samples[y * NIB_SIZE + x] = Math.round(255 * edge * variation);
    }
  }
  return samples;
}

/**
 * The paper: a distribution of tooth heights, not a picture of a sheet.
 *
 * This table is never tiled over the page. It is a *distribution* that the
 * paper field indexes into by spatially hashing the page coordinate, so the
 * sheet has no period at all rather than a period large enough to hope nobody
 * notices. A larger stored image would only delay repetition; this removes it.
 */
function generatePaper(): Uint8Array {
  const samples = new Uint8Array(PAPER_SIZE * PAPER_SIZE);
  for (let y = 0; y < PAPER_SIZE; y += 1) {
    for (let x = 0; x < PAPER_SIZE; x += 1) {
      samples[y * PAPER_SIZE + x] = Math.floor(materialHash(x, y, PAPER_SEED) * 256);
    }
  }
  return samples;
}

interface ResourceDefinition {
  readonly size: number;
  readonly generate: () => Uint8Array;
}

const DEFINITIONS: ReadonlyMap<MaterialResourceId, ResourceDefinition> = new Map([
  ["folio.graphite.hb-tip.v1", { size: NIB_SIZE, generate: generateNib }],
  ["folio.paper.graphite-tooth.v1", { size: PAPER_SIZE, generate: generatePaper }],
] as const);

/**
 * One decoded copy per build, shared by every stroke that names it.
 *
 * A decoded resource is immutable and identical for every caller, so there is
 * no reason for two of them to exist and a very good reason for there not to
 * be: a per-stroke copy of the paper field alone would be 64 KiB of duplicate
 * bytes for every mark on the page.
 */
const decoded = new Map<MaterialResourceId, MaterialResource>();

/**
 * Resolves one built-in resource id to its shared decoded field.
 *
 * An id this build does not contain fails loudly. Substituting a nearby
 * resource -- a plain disc, a generic grain -- would mean saved artwork quietly
 * came back looking like something else, which is worse than not opening.
 */
export function resolveMaterialResource(id: string): MaterialResource {
  const cached = decoded.get(id as MaterialResourceId);
  if (cached !== undefined) return cached;
  const definition = DEFINITIONS.get(id as MaterialResourceId);
  if (definition === undefined) {
    throw new InkError(
      "UNKNOWN_MATERIAL_RESOURCE",
      `Built-in material resource '${id}' is not registered.`,
      { id, registered: registeredMaterialResources() },
    );
  }
  const resource: MaterialResource = Object.freeze({
    id: id as MaterialResourceId,
    size: definition.size,
    samples: definition.generate(),
  });
  decoded.set(resource.id, resource);
  return resource;
}

/** Every built-in resource id this build contains, for validation and drift tests. */
export function registeredMaterialResources(): readonly string[] {
  return Object.freeze([...DEFINITIONS.keys()].sort());
}

/**
 * The resources `pencil@<version>` deposits through.
 *
 * **This binding is the durable resource identity.** A stroke names its
 * strategy as `(kind, version)` and the strategy version names its resources,
 * so the resource identity round-trips through the format that already exists
 * without a field being added to it, and a reopen resolves exactly the fields
 * the mark was made with. A later Pencil that wants a different nib is
 * `pencil@2` naming different ids here -- which is what a strategy version is
 * for, and is the only way the two can ever move.
 */
export function pencilMaterialResources(version: number): PencilMaterialResources {
  if (version !== 1) {
    throw new InkError(
      "UNKNOWN_MATERIAL_RESOURCE",
      `No built-in material resources are bound to 'pencil@${String(version)}'.`,
      { kind: "pencil", version },
    );
  }
  pencilV1 ??= Object.freeze({
    nib: resolveMaterialResource("folio.graphite.hb-tip.v1"),
    paper: resolveMaterialResource("folio.paper.graphite-tooth.v1"),
  });
  return pencilV1;
}

let pencilV1: PencilMaterialResources | null = null;

/** Drops every decoded resource, for tests that prove decoding is shared. */
export function releaseMaterialResources(): void {
  decoded.clear();
  pencilV1 = null;
}
