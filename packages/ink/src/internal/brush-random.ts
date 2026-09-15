/**
 * Deterministic variation for brush strategies that need it.
 *
 * Three properties are load-bearing, and every choice here follows from one of
 * them:
 *
 * - **Bit-identical on every engine.** Only `Math.imul`, `^`, `>>>` and integer
 *   literals appear, all of which ECMAScript specifies exactly. Nothing reaches
 *   for `Math.sin`, `Math.random`, or a float constant whose last bit differs
 *   between implementations.
 * - **Addressed, never streamed.** A value is a pure hash of its coordinates,
 *   not the n-th draw from a sequence. A sequential generator would hand a
 *   different value to the same mark the moment the stream were rebuilt from a
 *   different starting point, and live drawing rebuilds its tail every frame.
 * - **Channels are independent.** Adding a channel must not perturb one that
 *   already ships, so a channel is another hashed coordinate rather than
 *   another draw.
 *
 * The algorithm is pinned by the strategy version that reads it: changing any
 * constant below changes what a shipped `(kind, version)` draws, which is a
 * defect rather than a refinement.
 */

/** FNV-1a over UTF-16 code units, two bytes at a time so a non-ASCII id still mixes. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    hash = Math.imul(hash ^ (unit & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((unit >>> 8) & 0xff), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The seed one stroke's deterministic variation derives from.
 *
 * `Stroke.id` is already unique, already durable, and already round-trips
 * through the codec, so no new field has to become part of the format. It is
 * also the right identity for duplication: a copied object reuses the same
 * `Stroke`, so a duplicated mark keeps its grain instead of shimmering into a
 * different one.
 */
export function brushSeed(strokeId: string): number {
  return fnv1a32(strokeId);
}

/** splitmix32's finalizer: the avalanche step, and the only mixing this needs. */
function mix(value: number): number {
  let state = value >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x21f0aaad) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x735a2d97) >>> 0;
  return (state ^ (state >>> 15)) >>> 0;
}

/**
 * One deterministic 32-bit value for a point in a seeded three-coordinate grid.
 *
 * Coordinates may be negative: page space has no origin a stroke is obliged to
 * stay positive of, and `Math.imul` is exact on the whole signed 32-bit range.
 */
export function brushHash(seed: number, first: number, second: number, channel: number): number {
  let state = mix(seed ^ Math.imul(first | 0, 0x9e3779b1));
  state = mix(state ^ Math.imul(second | 0, 0x85ebca6b));
  return mix(state ^ Math.imul(channel | 0, 0xc2b2ae35));
}

/** Converts one hashed word into `[0, 1)` exactly, with no rounding surprise. */
export function unitFromHash(hash: number): number {
  return (hash >>> 0) / 4294967296;
}
