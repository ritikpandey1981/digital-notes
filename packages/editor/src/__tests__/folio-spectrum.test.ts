import { describe, expect, it } from "vitest";
import {
  classifySpectrumColor,
  nearestSpectrumFamily,
  nextSpectrumFamily,
  previousSpectrumFamily,
  requireSpectrumFamily,
  SPECTRUM_ACHROMATIC_CHROMA,
  SPECTRUM_CHROMA_TIERS,
  SPECTRUM_FAMILIES,
  SPECTRUM_LIGHTNESS_TIERS,
  SPECTRUM_NEUTRAL_GROUPS,
  spectrumFamilies,
  spectrumFamilyAnchor,
  spectrumFamilyById,
  spectrumFamilyVariants,
  spectrumNeutralGroups,
  spectrumVariant,
  type SpectrumLightnessTier,
} from "../foundation/folio-spectrum";
import { hueDistanceDegrees, oklchFromHex } from "../foundation/oklch-color";

const EXPECTED_ORDER = [
  "Red",
  "Red Orange",
  "Orange",
  "Amber",
  "Yellow",
  "Yellow Green",
  "Green",
  "Emerald",
  "Cyan",
  "Blue Cyan",
  "Blue",
  "Blue Violet",
  "Violet",
  "Purple",
  "Magenta",
  "Rose",
] as const;

describe("chromatic family catalog", () => {
  it("holds exactly sixteen families", () => {
    expect(SPECTRUM_FAMILIES).toHaveLength(16);
    expect(spectrumFamilies()).toBe(SPECTRUM_FAMILIES);
  });

  it("keeps the explicit artist ordering rather than an alphabetical one", () => {
    expect(SPECTRUM_FAMILIES.map(({ name }) => name)).toEqual([...EXPECTED_ORDER]);
    // Alphabetical order would start at Amber, so this is not incidentally sorted.
    expect(SPECTRUM_FAMILIES[0]?.name).not.toBe("Amber");
    expect(SPECTRUM_FAMILIES.map(({ index }) => index)).toEqual([...Array(16).keys()]);
  });

  it("walks the hue circle once, without revisiting", () => {
    // Each step advances around the wheel, so neighbours are visually adjacent.
    const hues = SPECTRUM_FAMILIES.map(({ hue }) => hue);
    for (let index = 1; index < hues.length - 1; index += 1) {
      expect(hues[index]!).toBeGreaterThan(hues[index - 1]!);
    }
    // Rose closes the loop below Red.
    expect(hues.at(-1)!).toBeLessThan(hues[0]!);
    expect(new Set(hues).size).toBe(16);
  });

  it("exposes stable unique identifiers", () => {
    expect(new Set(SPECTRUM_FAMILIES.map(({ id }) => id)).size).toBe(16);
    expect(spectrumFamilyById("blue")?.name).toBe("Blue");
    expect(spectrumFamilyById("chartreuse")).toBeUndefined();
    expect(() => requireSpectrumFamily("chartreuse")).toThrow(RangeError);
  });

  it("cycles forward from Rose to Red", () => {
    expect(nextSpectrumFamily("rose").id).toBe("red");
    expect(nextSpectrumFamily("red").id).toBe("red-orange");
  });

  it("cycles backward from Red to Rose", () => {
    expect(previousSpectrumFamily("red").id).toBe("rose");
    expect(previousSpectrumFamily("red-orange").id).toBe("red");
  });

  it("returns to the start after a full cycle in either direction", () => {
    let forward = SPECTRUM_FAMILIES[0]!;
    let backward = SPECTRUM_FAMILIES[0]!;
    for (let step = 0; step < 16; step += 1) {
      forward = nextSpectrumFamily(forward.id);
      backward = previousSpectrumFamily(backward.id);
    }
    expect(forward.id).toBe("red");
    expect(backward.id).toBe("red");
  });
});

describe("variant matrix", () => {
  it("gives every family exactly fifteen variants over the five by three grid", () => {
    for (const family of SPECTRUM_FAMILIES) {
      expect(family.variants).toHaveLength(15);
      for (const lightnessTier of SPECTRUM_LIGHTNESS_TIERS) {
        for (const chromaTier of SPECTRUM_CHROMA_TIERS) {
          expect(spectrumVariant(family.id, lightnessTier, chromaTier)).toMatchObject({
            familyId: family.id,
            lightnessTier,
            chromaTier,
          });
        }
      }
    }
    expect(spectrumFamilyVariants("green")).toBe(requireSpectrumFamily("green").variants);
    expect(() => spectrumVariant("green", "brightest" as SpectrumLightnessTier, "normal")).toThrow(
      RangeError,
    );
  });

  it("describes each variant with finite values and canonical hex", () => {
    for (const family of SPECTRUM_FAMILIES) {
      for (const variant of family.variants) {
        expect(variant.hex).toMatch(/^#[\da-f]{6}$/u);
        expect(Number.isFinite(variant.oklch.lightness)).toBe(true);
        expect(Number.isFinite(variant.oklch.chroma)).toBe(true);
        expect(Number.isFinite(variant.oklch.hue)).toBe(true);
        expect(variant.oklch.lightness).toBeGreaterThan(0);
        expect(variant.oklch.lightness).toBeLessThan(1);
        expect(variant.oklch.chroma).toBeGreaterThan(0);
        expect(variant.familyName).toBe(family.name);
        expect(variant.hue).toBe(family.hue);
      }
    }
  });

  it("anchors every family on its mid and normal variant", () => {
    for (const family of SPECTRUM_FAMILIES) {
      expect(family.anchor.lightnessTier).toBe("mid");
      expect(family.anchor.chromaTier).toBe("normal");
      expect(family.anchor.hex).toMatch(/^#[\da-f]{6}$/u);
      expect(family.variants).toContain(family.anchor);
      expect(spectrumFamilyAnchor(family.id)).toBe(family.anchor);
      // The anchor is genuinely coloured, never a near-grey.
      expect(oklchFromHex(family.anchor.hex).chroma).toBeGreaterThan(
        SPECTRUM_ACHROMATIC_CHROMA * 2,
      );
    }
  });

  it("keeps lightness strictly ordered within every chroma tier", () => {
    for (const family of SPECTRUM_FAMILIES) {
      for (const chromaTier of SPECTRUM_CHROMA_TIERS) {
        const measured = SPECTRUM_LIGHTNESS_TIERS.map(
          (lightnessTier) =>
            oklchFromHex(spectrumVariant(family.id, lightnessTier, chromaTier).hex).lightness,
        );
        for (let index = 1; index < measured.length; index += 1) {
          expect(
            measured[index]!,
            `${family.name} ${chromaTier} ${SPECTRUM_LIGHTNESS_TIERS[index]!}`,
          ).toBeLessThan(measured[index - 1]!);
        }
      }
    }
  });

  it("keeps chroma strictly ordered within every lightness tier", () => {
    for (const family of SPECTRUM_FAMILIES) {
      for (const lightnessTier of SPECTRUM_LIGHTNESS_TIERS) {
        const measured = SPECTRUM_CHROMA_TIERS.map(
          (chromaTier) =>
            oklchFromHex(spectrumVariant(family.id, lightnessTier, chromaTier).hex).chroma,
        );
        for (let index = 1; index < measured.length; index += 1) {
          expect(
            measured[index]!,
            `${family.name} ${lightnessTier} ${SPECTRUM_CHROMA_TIERS[index]!}`,
          ).toBeGreaterThan(measured[index - 1]!);
        }
      }
    }
  });

  it("does not collapse distinct variants after 8-bit quantization", () => {
    const everyHex = SPECTRUM_FAMILIES.flatMap((family) => family.variants.map(({ hex }) => hex));

    expect(everyHex).toHaveLength(240);
    // Nothing collapses at all today; the assertion is stated as a budget so a
    // future tier change reports how much it cost rather than only that it did.
    expect(new Set(everyHex).size).toBe(240);
    for (const family of SPECTRUM_FAMILIES) {
      expect(new Set(family.variants.map(({ hex }) => hex)).size, family.name).toBe(15);
    }
  });

  it("generates deterministically", () => {
    const snapshot = SPECTRUM_FAMILIES.map((family) => family.variants.map(({ hex }) => hex));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(SPECTRUM_FAMILIES.map((family) => family.variants.map(({ hex }) => hex))).toEqual(
        snapshot,
      );
    }
  });

  it("publishes immutable structures", () => {
    expect(Object.isFrozen(SPECTRUM_FAMILIES)).toBe(true);
    const family = SPECTRUM_FAMILIES[0]!;
    expect(Object.isFrozen(family)).toBe(true);
    expect(Object.isFrozen(family.variants)).toBe(true);
    expect(Object.isFrozen(family.anchor)).toBe(true);
    expect(Object.isFrozen(family.anchor.oklch)).toBe(true);
  });
});

describe("neutral and earth foundation", () => {
  it("keeps neutrals outside the chromatic cyclic ordering", () => {
    const chromaticIds = new Set(SPECTRUM_FAMILIES.map(({ id }) => id));
    for (const group of SPECTRUM_NEUTRAL_GROUPS) {
      expect(chromaticIds.has(group.id)).toBe(false);
    }
    // Nothing in the cycle can reach a neutral group.
    let family = SPECTRUM_FAMILIES[0]!;
    for (let step = 0; step < 32; step += 1) {
      family = nextSpectrumFamily(family.id);
      expect(chromaticIds.has(family.id)).toBe(true);
    }
    expect(spectrumNeutralGroups()).toBe(SPECTRUM_NEUTRAL_GROUPS);
  });

  it("provides the four semantic groups with canonical hex", () => {
    expect(SPECTRUM_NEUTRAL_GROUPS.map(({ id }) => id)).toEqual([
      "cool-gray",
      "neutral-gray",
      "warm-gray",
      "earth",
    ]);
    for (const group of SPECTRUM_NEUTRAL_GROUPS) {
      expect(group.swatches.length).toBeGreaterThan(0);
      for (const swatch of group.swatches) {
        expect(swatch.hex).toMatch(/^#[\da-f]{6}$/u);
        expect(swatch.groupId).toBe(group.id);
        expect(swatch.groupName).toBe(group.name);
        expect(Object.isFrozen(swatch)).toBe(true);
      }
    }
  });

  it("keeps the grey ramps ordered and the neutral ramp truly neutral", () => {
    for (const groupId of ["cool-gray", "neutral-gray", "warm-gray"]) {
      const group = SPECTRUM_NEUTRAL_GROUPS.find(({ id }) => id === groupId)!;
      const lightness = group.swatches.map(({ hex }) => oklchFromHex(hex).lightness);
      for (let index = 1; index < lightness.length; index += 1) {
        expect(lightness[index]!, groupId).toBeLessThan(lightness[index - 1]!);
      }
    }
    const neutral = SPECTRUM_NEUTRAL_GROUPS.find(({ id }) => id === "neutral-gray")!;
    for (const swatch of neutral.swatches) {
      const { red, green, blue } = channels(swatch.hex);
      expect(red).toBe(green);
      expect(green).toBe(blue);
    }
  });

  it("separates cool and warm greys by temperature at equal lightness", () => {
    const cool = SPECTRUM_NEUTRAL_GROUPS.find(({ id }) => id === "cool-gray")!.swatches[3]!;
    const warm = SPECTRUM_NEUTRAL_GROUPS.find(({ id }) => id === "warm-gray")!.swatches[3]!;

    expect(channels(cool.hex).blue).toBeGreaterThan(channels(cool.hex).red);
    expect(channels(warm.hex).red).toBeGreaterThan(channels(warm.hex).blue);
  });

  it("offers artist-recognisable earth tones", () => {
    const earth = SPECTRUM_NEUTRAL_GROUPS.find(({ id }) => id === "earth")!;

    expect(earth.swatches.map(({ name }) => name)).toContain("Burnt Sienna");
    expect(earth.swatches.map(({ name }) => name)).toContain("Ochre");
    // Earths are warm and low chroma: browns, not oranges.
    for (const swatch of earth.swatches) {
      expect(oklchFromHex(swatch.hex).chroma).toBeLessThan(0.13);
      expect(channels(swatch.hex).red).toBeGreaterThanOrEqual(channels(swatch.hex).blue);
    }
  });
});

describe("spectrum classification", () => {
  it.each([
    ["#e23b2e", "Red"],
    ["#c8422f", "Red"],
    ["#2f6fd0", "Blue"],
    ["#1e5fd8", "Blue"],
    ["#7b3fbf", "Violet"],
    ["#8a3fd0", "Violet"],
  ] as const)("places %s in a %s-family neighbourhood", (hex, expectedName) => {
    const classification = classifySpectrumColor(hex);
    if (classification.kind !== "chromatic") throw new Error("Expected a chromatic result.");
    const expected = SPECTRUM_FAMILIES.find(({ name }) => name === expectedName)!;

    // Named family, or an immediate neighbour: boundary hues are genuinely
    // ambiguous and the test should not pretend otherwise.
    expect(hueDistanceDegrees(classification.family.hue, expected.hue)).toBeLessThanOrEqual(30);
  });

  it("returns the nearest variant inside the chosen family", () => {
    const anchor = requireSpectrumFamily("blue").anchor;
    const classification = classifySpectrumColor(anchor.hex);
    if (classification.kind !== "chromatic") throw new Error("Expected a chromatic result.");

    expect(classification.family.id).toBe("blue");
    expect(classification.variant).toBe(anchor);
    expect(classification.distance).toBeLessThan(1e-6);
  });

  it("round trips every generated variant back to its own family", () => {
    for (const family of SPECTRUM_FAMILIES) {
      const classification = classifySpectrumColor(family.anchor.hex);
      if (classification.kind !== "chromatic") throw new Error("Expected a chromatic result.");
      expect(classification.family.id, family.name).toBe(family.id);
    }
  });

  it.each(["#000000", "#ffffff", "#808080", "#3a3a3a", "#d1d1d1"])(
    "classifies %s as neutral rather than inventing a hue",
    (hex) => {
      const classification = classifySpectrumColor(hex);

      expect(classification.kind).toBe("neutral");
      if (classification.kind !== "neutral") return;
      expect(classification.group.id).toMatch(/gray|earth/u);
      expect(classification.swatch.hex).toMatch(/^#[\da-f]{6}$/u);
      expect(nearestSpectrumFamily(hex)).toBeNull();
    },
  );

  it("keeps achromatic classification deterministic across repeated calls", () => {
    // A perfectly neutral grey still reports a hue angle from float noise, so
    // an unguarded lookup would assign it a confident and arbitrary family.
    const first = classifySpectrumColor("#808080");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const repeat = classifySpectrumColor("#808080");
      expect(repeat.kind).toBe(first.kind);
      if (repeat.kind === "neutral" && first.kind === "neutral") {
        expect(repeat.swatch.hex).toBe(first.swatch.hex);
      }
    }
  });

  it("still classifies a barely chromatic colour as chromatic", () => {
    const family = SPECTRUM_FAMILIES.find(({ id }) => id === "blue")!;
    const dullest = family.variants.find(
      (variant) => variant.lightnessTier === "very-light" && variant.chromaTier === "muted",
    )!;

    expect(oklchFromHex(dullest.hex).chroma).toBeGreaterThan(SPECTRUM_ACHROMATIC_CHROMA);
    expect(classifySpectrumColor(dullest.hex).kind).toBe("chromatic");
  });

  it("accepts any canonical hex casing without changing the answer", () => {
    expect(classifySpectrumColor("#E23B2E")).toEqual(classifySpectrumColor("#e23b2e"));
  });
});

describe("generation cost", () => {
  it("precomputes once so lookups stay cheap", () => {
    // Guards against a future refactor that regenerates on every access.
    const anchor = spectrumFamilyAnchor("blue");
    const started = performance.now();
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      spectrumFamilyAnchor("blue");
      nextSpectrumFamily("rose");
    }
    expect(spectrumFamilyAnchor("blue")).toBe(anchor);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
      expect(performance.now() - started).toBeLessThan(250);
  });
});

function channels(hex: string): Readonly<{ red: number; green: number; blue: number }> {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}
