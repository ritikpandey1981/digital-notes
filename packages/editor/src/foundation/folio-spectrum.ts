import { normalizeArtworkHex } from "./color-conversion";
import {
  gamutMapOklch,
  hexFromOklch,
  hueDistanceDegrees,
  maximumDisplayableChroma,
  oklabFromOklch,
  oklabSquaredDistance,
  oklchFromHex,
  type OklchColor,
} from "./oklch-color";

/**
 * The Folio Spectrum: a systematic, artist-oriented palette foundation.
 *
 * This module is pure data and lookup. It owns no current colour and no
 * application state — a Spectrum colour becomes an ordinary canonical hex the
 * moment it reaches Folio's existing colour target architecture, exactly like a
 * palette swatch does today.
 *
 * The organising idea borrowed from professional marker systems is that colours
 * should be *navigable*: from any colour an artist should be able to reach a
 * lighter, darker, duller or purer neighbour without hunting. So every
 * chromatic colour has coordinates — family, lightness tier, chroma tier —
 * rather than being an isolated swatch.
 */

export type SpectrumLightnessTier = "very-light" | "light" | "mid" | "dark" | "very-dark";
export type SpectrumChromaTier = "muted" | "normal" | "vivid";

/** Display order, lightest first. */
export const SPECTRUM_LIGHTNESS_TIERS: readonly SpectrumLightnessTier[] = Object.freeze([
  "very-light",
  "light",
  "mid",
  "dark",
  "very-dark",
]);

/** Display order, dullest first. */
export const SPECTRUM_CHROMA_TIERS: readonly SpectrumChromaTier[] = Object.freeze([
  "muted",
  "normal",
  "vivid",
]);

export interface SpectrumVariant {
  readonly familyId: string;
  readonly familyName: string;
  /** The family's representative hue, in degrees. */
  readonly hue: number;
  readonly lightnessTier: SpectrumLightnessTier;
  readonly chromaTier: SpectrumChromaTier;
  /** The gamut-mapped definition this variant's hex was produced from. */
  readonly oklch: OklchColor;
  /** Canonical lowercase six-digit hex. */
  readonly hex: string;
}

export interface SpectrumFamily {
  readonly id: string;
  readonly name: string;
  /** Position in the cyclic display order, starting at zero. */
  readonly index: number;
  readonly hue: number;
  /** The mid tier's lightness, chosen so the anchor reads as this family. */
  readonly anchorLightness: number;
  /** The mid / normal variant. */
  readonly anchor: SpectrumVariant;
  /** All fifteen variants, lightness-major in display order. */
  readonly variants: readonly SpectrumVariant[];
}

export interface SpectrumNeutralSwatch {
  readonly groupId: string;
  readonly groupName: string;
  readonly name: string;
  readonly oklch: OklchColor;
  readonly hex: string;
}

export interface SpectrumNeutralGroup {
  readonly id: string;
  readonly name: string;
  readonly swatches: readonly SpectrumNeutralSwatch[];
}

/**
 * Where an arbitrary colour sits in the Spectrum.
 *
 * The two cases are kept explicit rather than collapsed into one "nearest
 * family" answer. Hue is undefined as chroma approaches zero, so claiming a
 * grey belongs to Red or Blue would be inventing information — and a future
 * RGB mode reading that answer back would jump between families on noise.
 */
export type SpectrumClassification =
  | Readonly<{
      kind: "chromatic";
      family: SpectrumFamily;
      /** Nearest variant within that family, perceptually. */
      variant: SpectrumVariant;
      /** Squared OKLab distance to `variant`. */
      distance: number;
    }>
  | Readonly<{
      kind: "neutral";
      group: SpectrumNeutralGroup;
      swatch: SpectrumNeutralSwatch;
      /** Squared OKLab distance to `swatch`. */
      distance: number;
    }>;

/**
 * Below this chroma a colour is treated as achromatic.
 *
 * Chosen above the float noise a mid grey produces (a perfectly neutral
 * `#808080` still reports a hue) and below the dullest chromatic variant this
 * module generates, so the two classifications never contend.
 */
export const SPECTRUM_ACHROMATIC_CHROMA = 0.018;

/**
 * Lightness spread around a family's anchor.
 *
 * The ramp is anchored per family rather than fixed globally because hues do
 * not share a natural lightness: a yellow at the lightness of a credible blue
 * is olive. Each family's spread is then compressed to fit the safe band, which
 * keeps all five tiers strictly ordered even where headroom is short.
 */
const LIGHTNESS_SPREAD_UP = 0.3;
const LIGHTNESS_SPREAD_DOWN = 0.32;
const LIGHTNESS_CEILING = 0.955;
const LIGHTNESS_FLOOR = 0.16;

/**
 * Chroma tiers as a fraction of what sRGB can actually display.
 *
 * A single absolute chroma per tier would be dishonest: sRGB holds roughly
 * three times more chroma at a light yellow-green than at a light red. Scaling
 * by the hue's own maximum keeps `vivid` genuinely vivid everywhere while the
 * relationship muted < normal < vivid stays intact.
 */
const CHROMA_TIER_FRACTIONS: Readonly<Record<SpectrumChromaTier, number>> = Object.freeze({
  muted: 0.38,
  normal: 0.72,
  vivid: 1,
});

interface SpectrumFamilyDefinition {
  readonly id: string;
  readonly name: string;
  readonly hue: number;
  readonly anchorLightness: number;
}

/**
 * The sixteen chromatic families, in cyclic artist order.
 *
 * Ordering is explicit and deliberately not alphabetical: it walks the hue
 * circle the way a colour wheel does, so `next` and `previous` move to a
 * visually adjacent family. Hue angles are spaced unevenly on purpose — the
 * warm quadrant gets finer steps because that is where artists discriminate
 * most, and OKLCH hue is not perceptually uniform in step size.
 *
 * `anchorLightness` is the one hand-set number per family. It is what makes the
 * mid / normal variant read as "this family" rather than as an arbitrary slice
 * of a global ramp.
 */
const SPECTRUM_FAMILY_DEFINITIONS: readonly SpectrumFamilyDefinition[] = Object.freeze([
  { id: "red", name: "Red", hue: 29, anchorLightness: 0.62 },
  { id: "red-orange", name: "Red Orange", hue: 41, anchorLightness: 0.645 },
  { id: "orange", name: "Orange", hue: 55, anchorLightness: 0.7 },
  { id: "amber", name: "Amber", hue: 75, anchorLightness: 0.77 },
  { id: "yellow", name: "Yellow", hue: 100, anchorLightness: 0.87 },
  { id: "yellow-green", name: "Yellow Green", hue: 122, anchorLightness: 0.82 },
  { id: "green", name: "Green", hue: 145, anchorLightness: 0.73 },
  { id: "emerald", name: "Emerald", hue: 165, anchorLightness: 0.7 },
  { id: "cyan", name: "Cyan", hue: 195, anchorLightness: 0.75 },
  { id: "blue-cyan", name: "Blue Cyan", hue: 225, anchorLightness: 0.68 },
  { id: "blue", name: "Blue", hue: 258, anchorLightness: 0.55 },
  { id: "blue-violet", name: "Blue Violet", hue: 280, anchorLightness: 0.52 },
  { id: "violet", name: "Violet", hue: 300, anchorLightness: 0.55 },
  { id: "purple", name: "Purple", hue: 315, anchorLightness: 0.58 },
  { id: "magenta", name: "Magenta", hue: 330, anchorLightness: 0.62 },
  { id: "rose", name: "Rose", hue: 5, anchorLightness: 0.63 },
]);

interface NeutralGroupDefinition {
  readonly id: string;
  readonly name: string;
  readonly swatches: readonly Readonly<{ name: string; oklch: OklchColor }>[];
}

/** Shared grey ramp, lightest first. */
const GREY_STEPS: readonly Readonly<{ name: string; lightness: number }>[] = Object.freeze([
  { name: "10", lightness: 0.95 },
  { name: "20", lightness: 0.86 },
  { name: "30", lightness: 0.75 },
  { name: "40", lightness: 0.63 },
  { name: "50", lightness: 0.5 },
  { name: "60", lightness: 0.37 },
  { name: "70", lightness: 0.24 },
]);

function greyGroup(id: string, name: string, hue: number, chroma: number): NeutralGroupDefinition {
  return Object.freeze({
    id,
    name,
    swatches: Object.freeze(
      GREY_STEPS.map((step) =>
        Object.freeze({
          name: `${name} ${step.name}`,
          oklch: Object.freeze({ lightness: step.lightness, chroma, hue }),
        }),
      ),
    ),
  });
}

/**
 * Neutrals and earths, deliberately outside the cyclic reel.
 *
 * Greys share one lightness ramp and differ only by a slight temperature bias,
 * which is what makes a "cool grey" set usable next to a "warm grey" set. The
 * earth tones are declared rather than generated: pigment-derived colours such
 * as sienna and umber are not a regular slice of any hue ramp, and pretending
 * otherwise would produce plausible-looking browns that no artist recognises.
 */
const NEUTRAL_GROUP_DEFINITIONS: readonly NeutralGroupDefinition[] = Object.freeze([
  greyGroup("cool-gray", "Cool Gray", 250, 0.011),
  greyGroup("neutral-gray", "Neutral Gray", 0, 0),
  greyGroup("warm-gray", "Warm Gray", 70, 0.013),
  Object.freeze({
    id: "earth",
    name: "Earth",
    swatches: Object.freeze([
      { name: "Ivory", oklch: Object.freeze({ lightness: 0.94, chroma: 0.026, hue: 92 }) },
      { name: "Sand", oklch: Object.freeze({ lightness: 0.86, chroma: 0.045, hue: 84 }) },
      { name: "Ochre", oklch: Object.freeze({ lightness: 0.74, chroma: 0.104, hue: 78 }) },
      { name: "Raw Sienna", oklch: Object.freeze({ lightness: 0.63, chroma: 0.112, hue: 62 }) },
      { name: "Burnt Sienna", oklch: Object.freeze({ lightness: 0.52, chroma: 0.122, hue: 43 }) },
      { name: "Terracotta", oklch: Object.freeze({ lightness: 0.6, chroma: 0.108, hue: 33 }) },
      { name: "Raw Umber", oklch: Object.freeze({ lightness: 0.44, chroma: 0.07, hue: 72 }) },
      { name: "Burnt Umber", oklch: Object.freeze({ lightness: 0.35, chroma: 0.062, hue: 52 }) },
      { name: "Sepia", oklch: Object.freeze({ lightness: 0.28, chroma: 0.038, hue: 58 }) },
    ]),
  }),
]);

/** Lightness for one tier of one family, compressed to stay strictly ordered. */
function tierLightness(anchorLightness: number, tier: SpectrumLightnessTier): number {
  const up = Math.min(LIGHTNESS_SPREAD_UP, LIGHTNESS_CEILING - anchorLightness);
  const down = Math.min(LIGHTNESS_SPREAD_DOWN, anchorLightness - LIGHTNESS_FLOOR);
  switch (tier) {
    case "very-light":
      return anchorLightness + up;
    case "light":
      return anchorLightness + up / 2;
    case "mid":
      return anchorLightness;
    case "dark":
      return anchorLightness - down / 2;
    case "very-dark":
      return anchorLightness - down;
  }
}

function buildVariant(
  definition: SpectrumFamilyDefinition,
  lightnessTier: SpectrumLightnessTier,
  chromaTier: SpectrumChromaTier,
): SpectrumVariant {
  const lightness = tierLightness(definition.anchorLightness, lightnessTier);
  const ceiling = maximumDisplayableChroma(lightness, definition.hue);
  const oklch = gamutMapOklch({
    lightness,
    chroma: ceiling * CHROMA_TIER_FRACTIONS[chromaTier],
    hue: definition.hue,
  });
  return Object.freeze({
    familyId: definition.id,
    familyName: definition.name,
    hue: definition.hue,
    lightnessTier,
    chromaTier,
    oklch,
    hex: hexFromOklch(oklch),
  });
}

function buildFamily(definition: SpectrumFamilyDefinition, index: number): SpectrumFamily {
  const variants = Object.freeze(
    SPECTRUM_LIGHTNESS_TIERS.flatMap((lightnessTier) =>
      SPECTRUM_CHROMA_TIERS.map((chromaTier) =>
        buildVariant(definition, lightnessTier, chromaTier),
      ),
    ),
  );
  const anchor = variants.find(
    (variant) => variant.lightnessTier === "mid" && variant.chromaTier === "normal",
  );
  if (anchor === undefined) throw new Error(`Family '${definition.id}' has no anchor variant.`);
  return Object.freeze({
    id: definition.id,
    name: definition.name,
    index,
    hue: definition.hue,
    anchorLightness: definition.anchorLightness,
    anchor,
    variants,
  });
}

/**
 * Every chromatic family, generated once at module load.
 *
 * Generation gamut-maps 240 colours, each a short chroma bisection. Doing it
 * once here keeps every later lookup a plain array read, which matters because
 * the future reel animates.
 */
export const SPECTRUM_FAMILIES: readonly SpectrumFamily[] = Object.freeze(
  SPECTRUM_FAMILY_DEFINITIONS.map(buildFamily),
);

export const SPECTRUM_NEUTRAL_GROUPS: readonly SpectrumNeutralGroup[] = Object.freeze(
  NEUTRAL_GROUP_DEFINITIONS.map((group) =>
    Object.freeze({
      id: group.id,
      name: group.name,
      swatches: Object.freeze(
        group.swatches.map((swatch) => {
          const oklch = gamutMapOklch(swatch.oklch);
          return Object.freeze({
            groupId: group.id,
            groupName: group.name,
            name: swatch.name,
            oklch,
            hex: hexFromOklch(oklch),
          });
        }),
      ),
    }),
  ),
);

const FAMILY_BY_ID: ReadonlyMap<string, SpectrumFamily> = new Map(
  SPECTRUM_FAMILIES.map((family) => [family.id, family]),
);

/** Every chromatic family in cyclic display order. */
export function spectrumFamilies(): readonly SpectrumFamily[] {
  return SPECTRUM_FAMILIES;
}

export function spectrumFamilyById(familyId: string): SpectrumFamily | undefined {
  return FAMILY_BY_ID.get(familyId);
}

export function requireSpectrumFamily(familyId: string): SpectrumFamily {
  const family = spectrumFamilyById(familyId);
  if (family === undefined) throw new RangeError(`Unknown Spectrum family '${familyId}'.`);
  return family;
}

/** The next family, wrapping Rose back to Red. */
export function nextSpectrumFamily(familyId: string): SpectrumFamily {
  const family = requireSpectrumFamily(familyId);
  return SPECTRUM_FAMILIES[(family.index + 1) % SPECTRUM_FAMILIES.length]!;
}

/** The previous family, wrapping Red back to Rose. */
export function previousSpectrumFamily(familyId: string): SpectrumFamily {
  const family = requireSpectrumFamily(familyId);
  const length = SPECTRUM_FAMILIES.length;
  return SPECTRUM_FAMILIES[(family.index - 1 + length) % length]!;
}

export function spectrumFamilyAnchor(familyId: string): SpectrumVariant {
  return requireSpectrumFamily(familyId).anchor;
}

export function spectrumFamilyVariants(familyId: string): readonly SpectrumVariant[] {
  return requireSpectrumFamily(familyId).variants;
}

/** One variant by its grid coordinate. */
export function spectrumVariant(
  familyId: string,
  lightnessTier: SpectrumLightnessTier,
  chromaTier: SpectrumChromaTier,
): SpectrumVariant {
  const variant = requireSpectrumFamily(familyId).variants.find(
    (candidate) => candidate.lightnessTier === lightnessTier && candidate.chromaTier === chromaTier,
  );
  if (variant === undefined) {
    throw new RangeError(`Unknown Spectrum coordinate '${lightnessTier}/${chromaTier}'.`);
  }
  return variant;
}

export function spectrumNeutralGroups(): readonly SpectrumNeutralGroup[] {
  return SPECTRUM_NEUTRAL_GROUPS;
}

/**
 * The chromatic family whose hue is closest to this colour's.
 *
 * Returns null for effectively achromatic input rather than resolving hue noise
 * into a confident answer.
 */
export function nearestSpectrumFamily(hex: string): SpectrumFamily | null {
  const oklch = oklchFromHex(normalizeArtworkHex(hex));
  if (oklch.chroma < SPECTRUM_ACHROMATIC_CHROMA) return null;
  let nearest = SPECTRUM_FAMILIES[0]!;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const family of SPECTRUM_FAMILIES) {
    const distance = hueDistanceDegrees(oklch.hue, family.hue);
    // Strict comparison keeps the earliest family on an exact tie.
    if (distance < nearestDistance) {
      nearest = family;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Places an arbitrary canonical colour in the Spectrum.
 *
 * Family selection uses hue, because hue is what defines a family and what a
 * future reel scrolls through. The variant within that family is then chosen
 * perceptually, in OKLab, so lightness and chroma both count.
 */
export function classifySpectrumColor(hex: string): SpectrumClassification {
  const canonical = normalizeArtworkHex(hex);
  const oklch = oklchFromHex(canonical);
  const sample = oklabFromOklch(oklch);
  const family = nearestSpectrumFamily(canonical);
  if (family === null) {
    let nearestGroup = SPECTRUM_NEUTRAL_GROUPS[0]!;
    let nearestSwatch = nearestGroup.swatches[0]!;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const group of SPECTRUM_NEUTRAL_GROUPS) {
      for (const swatch of group.swatches) {
        const distance = oklabSquaredDistance(sample, oklabFromOklch(swatch.oklch));
        if (distance < nearestDistance) {
          nearestGroup = group;
          nearestSwatch = swatch;
          nearestDistance = distance;
        }
      }
    }
    return Object.freeze({
      kind: "neutral",
      group: nearestGroup,
      swatch: nearestSwatch,
      distance: nearestDistance,
    });
  }
  let nearestVariant = family.anchor;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const variant of family.variants) {
    const distance = oklabSquaredDistance(sample, oklabFromOklch(variant.oklch));
    if (distance < nearestDistance) {
      nearestVariant = variant;
      nearestDistance = distance;
    }
  }
  return Object.freeze({
    kind: "chromatic",
    family,
    variant: nearestVariant,
    distance: nearestDistance,
  });
}
