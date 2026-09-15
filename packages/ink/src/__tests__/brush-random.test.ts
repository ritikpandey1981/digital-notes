import { describe, expect, it } from "vitest";
import { brushHash, brushSeed, fnv1a32, unitFromHash } from "../internal/brush-random";

/**
 * Deterministic variation is only worth having if it is the *same* variation
 * everywhere: live and committed, before and after a save, on whatever engine
 * happens to be running. These are the properties the strategies that use it
 * are allowed to assume.
 */

describe("brush randomness", () => {
  it("derives a stable seed from a stroke id", () => {
    expect(brushSeed("stroke-a")).toBe(brushSeed("stroke-a"));
    expect(brushSeed("stroke-a")).not.toBe(brushSeed("stroke-b"));
    // Pinned, because a strategy's appearance is a function of this number and
    // changing it would redraw every pencil stroke ever saved.
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(brushSeed("folio")).toBe(fnv1a32("folio"));
    expect(brushSeed("00000000-0000-4000-8000-000000000000")).toBe(3_772_308_361);
  });

  it("mixes the whole code unit, so two ids differing above the first byte differ", () => {
    // Hashing only the low byte would collide every pair of characters 256
    // apart, which real identifiers do contain.
    expect(fnv1a32(String.fromCharCode(0x0100))).not.toBe(fnv1a32(String.fromCharCode(0)));
    expect(fnv1a32("अभ्यास")).not.toBe(fnv1a32("abhyas"));
  });

  it("returns one unsigned 32-bit value per coordinate", () => {
    for (const value of [
      brushHash(1, 0, 0, 0),
      brushHash(0, -5, 7, 3),
      brushHash(0xffffffff, 1_000_000, -1_000_000, 2),
    ]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("is addressed rather than streamed, so order of enquiry never matters", () => {
    const first = brushHash(7, 3, 4, 1);
    brushHash(7, 99, 99, 9);
    brushHash(7, 0, 0, 0);
    expect(brushHash(7, 3, 4, 1)).toBe(first);
  });

  it("separates every coordinate, including the sign of a cell", () => {
    const values = new Set([
      brushHash(7, 3, 4, 0),
      brushHash(7, 4, 3, 0),
      brushHash(7, -3, 4, 0),
      brushHash(7, 3, -4, 0),
      brushHash(8, 3, 4, 0),
      brushHash(7, 3, 4, 1),
    ]);
    expect(values.size).toBe(6);
  });

  it("keeps a new channel from perturbing the ones already shipping", () => {
    // The reason variation is hashed rather than drawn from a sequence: adding
    // a fifth channel to a strategy must not move the four before it.
    const existing = [0, 1, 2, 3].map((channel) => brushHash(42, 11, -6, channel));
    brushHash(42, 11, -6, 4);
    expect([0, 1, 2, 3].map((channel) => brushHash(42, 11, -6, channel))).toEqual(existing);
  });

  it("converts into the unit interval without reaching one", () => {
    expect(unitFromHash(0)).toBe(0);
    expect(unitFromHash(0xffffffff)).toBeCloseTo(1, 9);
    expect(unitFromHash(0xffffffff)).toBeLessThan(1);
    const samples = Array.from({ length: 2_000 }, (_, index) =>
      unitFromHash(brushHash(3, index, index * 7, 0)),
    );
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // Flat enough to threshold against: a coverage of 0.5 should ink about half.
    const below = samples.filter((value) => value < 0.5).length;
    expect(below).toBeGreaterThan(900);
    expect(below).toBeLessThan(1_100);
  });
});
