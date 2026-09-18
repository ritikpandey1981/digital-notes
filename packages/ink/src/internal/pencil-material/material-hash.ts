/**
 * The deterministic field primitive every Pencil material resource and field is
 * addressed through.
 *
 * This is deliberately *not* {@link brushHash}. That one is pinned by the
 * geometry `pencil@1` already draws; this one is pinned by the material
 * resource versions in {@link ./resources.ts}, and the two are versioned by
 * different things. Folding them together would mean a refinement to either
 * model silently rewrote the other, which is the single failure the versioned
 * vocabulary exists to prevent.
 *
 * The same three properties the geometry hash needs apply here, for the same
 * reasons: bit-identical on every engine, because only `Math.imul`, `^`, `>>>`
 * and integer literals appear; addressed rather than streamed, so the same
 * patch of paper answers the same question however the material is rebuilt; and
 * channelled, so a field added later cannot perturb one already generated.
 *
 * The constants are those the approved material prototype was measured and
 * reviewed at. Changing one changes what every built-in resource contains and
 * what every deposited pixel is, so a change here is a new resource version
 * rather than an edit.
 */

/** One deterministic value in `[0, 1)` for a point in a seeded integer lattice. */
export function materialHash(x: number, y: number, seed: number): number {
  let state = (Math.imul(x | 0, 374_761_393) ^ Math.imul(y | 0, 668_265_263) ^ (seed | 0)) | 0;
  state = Math.imul(state ^ (state >>> 13), 1_274_126_177);
  return ((state ^ (state >>> 16)) >>> 0) / 4_294_967_296;
}

/**
 * Smooth value noise over {@link materialHash}, in `[0, 1]`.
 *
 * The four lattice corners around the sample, blended by a smoothstep so there
 * is no seam at a cell boundary. Coordinates arrive already divided by the
 * field's own cell size, so one implementation serves fields of every scale.
 */
export function materialNoise(x: number, y: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const easedX = fractionX * fractionX * (3 - 2 * fractionX);
  const easedY = fractionY * fractionY * (3 - 2 * fractionY);
  const topLeft = materialHash(cellX, cellY, seed);
  const topRight = materialHash(cellX + 1, cellY, seed);
  const bottomLeft = materialHash(cellX, cellY + 1, seed);
  const bottomRight = materialHash(cellX + 1, cellY + 1, seed);
  const top = topLeft * (1 - easedX) + topRight * easedX;
  const bottom = bottomLeft * (1 - easedX) + bottomRight * easedX;
  return top * (1 - easedY) + bottom * easedY;
}

export function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
