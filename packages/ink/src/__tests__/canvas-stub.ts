import { vi } from "vitest";

/**
 * A canvas that records instead of rasterizing.
 *
 * Material painting goes through a real `HTMLCanvasElement` -- a tile's alpha is
 * uploaded and tinted there -- so a unit test either needs a DOM or needs this.
 * What it can settle without one is the painter's *contract*: which tiles were
 * drawn, where they were put, which colour tinted them, and that base opacity
 * was not applied a second time. Whether the resulting pixels look like
 * graphite is settled by the material suites and, in the end, by the eye.
 */

/**
 * Where a `drawImage` put something, whichever form the caller used.
 *
 * A tile is blitted from inside a padded presentation, so the call carries a
 * source rectangle as well as a destination. Recording the first four numbers
 * would record the source and quietly assert the wrong thing.
 */
function destinationOf(rest: readonly number[]): RecordedDraw {
  const nine = rest.length >= 8;
  const d = nine ? rest.slice(4) : rest;
  return {
    x: d[0] ?? 0,
    y: d[1] ?? 0,
    width: d[2] ?? 0,
    height: d[3] ?? 0,
    source: nine
      ? { x: rest[0] ?? 0, y: rest[1] ?? 0, width: rest[2] ?? 0, height: rest[3] ?? 0 }
      : null,
  };
}

export interface RecordedDraw {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The source rectangle, when the caller gave one. Null for the short form. */
  readonly source: Readonly<{ x: number; y: number; width: number; height: number }> | null;
}

export interface CanvasStub {
  readonly draws: RecordedDraw[];
  /** Every pixel buffer uploaded to a tile canvas, so a test can read a gutter. */
  readonly uploads: { width: number; height: number; data: Uint8ClampedArray }[];
  /** Colours used to tint a tile, in order. */
  readonly fills: string[];
  /** `globalAlpha` in force at each tint, to prove opacity is applied once. */
  readonly fillAlphas: number[];
  readonly created: number;
  restore(): void;
}

interface StubContext {
  canvas: { width: number; height: number };
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string;
  imageSmoothingEnabled: boolean;
}

/**
 * Installs a `document` whose canvases record.
 *
 * Restores whatever was there before, so a suite that runs in a real DOM is not
 * left with the stub.
 */
export function installCanvasStub(): CanvasStub {
  const draws: RecordedDraw[] = [];
  const uploads: { width: number; height: number; data: Uint8ClampedArray }[] = [];
  const fills: string[] = [];
  const fillAlphas: number[] = [];
  let created = 0;

  const createCanvas = (): unknown => {
    created += 1;
    const element = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    };
    const context: StubContext & Record<string, unknown> = {
      canvas: element,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      imageSmoothingEnabled: true,
      getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
      strokeRect: vi.fn(),
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn((image: { width: number; height: number; data: Uint8ClampedArray }) => {
        uploads.push({ width: image.width, height: image.height, data: image.data.slice() });
      }),
      clearRect: vi.fn(),
      fillRect: vi.fn(() => {
        fills.push(String(context.fillStyle));
        fillAlphas.push(context.globalAlpha);
      }),
      drawImage: vi.fn((_source: unknown, ...rest: number[]) => {
        draws.push(destinationOf(rest));
      }),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      setTransform: vi.fn(),
    };
    return element;
  };

  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`The canvas stub only makes canvases, not '${tag}'.`);
      return createCanvas();
    },
  };

  return {
    draws,
    uploads,
    fills,
    fillAlphas,
    get created() {
      return created;
    },
    restore() {
      if (previous === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = previous;
    },
  };
}

/**
 * The upright transform a recording context reports.
 *
 * Only the six components a painter can act on, because that is all the tile
 * painter reads: it snaps a destination onto whole device pixels, and to do
 * that it needs the scale and translation it is drawing under.
 */
export interface StubTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY_TRANSFORM: StubTransform = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

/** A recording 2D context, for painting one stroke straight into a test. */
export function recordingContext(transform: StubTransform = IDENTITY_TRANSFORM): {
  context: CanvasRenderingContext2D;
  draws: RecordedDraw[];
  alphas: number[];
} {
  const draws: RecordedDraw[] = [];
  const alphas: number[] = [];
  const context = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    imageSmoothingEnabled: false,
    getTransform: vi.fn(() => ({ ...transform })),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn((_source: unknown, ...rest: number[]) => {
      draws.push(destinationOf(rest));
      alphas.push((context as unknown as { globalAlpha: number }).globalAlpha);
    }),
  } as unknown as CanvasRenderingContext2D;
  return { context, draws, alphas };
}
