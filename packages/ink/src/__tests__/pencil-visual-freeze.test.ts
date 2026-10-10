import { describe, expect, it } from "vitest";
import {
  createResolvedBrushSnapshot,
  supportedBrushStrategies,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  MaterialFieldCache,
  PencilDabIndex,
  PencilMaterialAccumulator,
  TILE_CELLS,
  createPencilMaterialProgram,
  reconstructMaterial,
  reconstructMaterialTile,
  registeredMaterialResources,
  releaseMaterialResources,
  resolveMaterialResource,
  type CommittedMaterialTile,
  type MaterialTileKey,
} from "../internal/pencil-material";
import { assemblePresentationAlpha } from "../internal/pencil-material-strategy";
import type { StrokePoint } from "../types";

/**
 * `pencil@1` draws the marks it draws today, for ever.
 *
 * The artist has looked at the production Pencil and approved it, so its output
 * is now artwork's business rather than the engine's. Everything else about the
 * medium is still open -- the scheduler, the eviction order, the buffers, how
 * much is allocated and when -- and the next phase goes after exactly those.
 * This file is what makes that safe: it pins the *result*, so an optimization
 * that changes a byte of graphite fails here and nowhere subtler.
 *
 * It does not duplicate the behavioural suites. They say *why* the mark looks
 * right -- a tap is a textured tip and not a disc, a terminal is a full tip,
 * pressure reveals more of the same sheet, a retrace darkens, the artist's
 * colour is nowhere in the material. Those claims live in
 * [`pencil-material-model.test.ts`](pencil-material-model.test.ts) and
 * [`pencil.test.ts`](pencil.test.ts), and they are the gate on whether a
 * *proposed* appearance is acceptable. What this file adds is the only thing
 * they cannot give: the absolute value. Every one of them would still pass if a
 * change moved all three deposition paths together, which is precisely the
 * shape a memory optimization has.
 *
 * Two deliberate choices about how it is built:
 *
 * **Nothing is shared.** The brush and the shapes below are transcribed here
 * rather than imported from [`pencil-material-fixture.ts`](pencil-material-fixture.ts).
 * A helper another suite can edit for its own reasons is a way for this gate to
 * report that Pencil changed when it did not, which is worse than no gate.
 *
 * **Digests are page cells, not tiles.** A cell is named by where it is on the
 * page, so the pinned value is independent of how the material happens to be
 * tiled. Tiling is a cache decision; a later phase may change it, and must not
 * have to re-pin the artwork to do so.
 */

/** Compact, order-sensitive digest, the convention the other freeze gates use. */
function hash(value: string): string {
  let accumulator = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    accumulator ^= value.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x0100_0193);
  }
  return (accumulator >>> 0).toString(36);
}

function byteDigest(samples: Uint8Array): string {
  let accumulator = 0x811c_9dc5;
  for (const value of samples) {
    accumulator ^= value;
    accumulator = Math.imul(accumulator, 0x0100_0193);
  }
  return (accumulator >>> 0).toString(36);
}

/**
 * The shipped `pencil-hb`, transcribed.
 *
 * Size is the only parameter varied across the frozen set, because it is the
 * one the artist chooses. The rest is the preset the editor hands `pencil@1` by
 * default, so what is frozen here is the appearance a person actually approved
 * rather than a configuration nobody draws with.
 */
function frozenBrush(size: number): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pencil-hb",
    presetVersion: 1,
    family: "pencil",
    color: "#343434",
    size,
    opacity: 0.78,
    smoothing: Object.freeze({ mode: "average", amount: 0.2 }),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: true,
        minimumFactor: 0.65,
        maximumFactor: 1.25,
        curve: Object.freeze({ kind: "linear", exponent: 1 }),
      }),
      pressureOpacity: Object.freeze({
        enabled: true,
        minimumFactor: 0.45,
        maximumFactor: 1,
        curve: Object.freeze({ kind: "power", exponent: 0.75 }),
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "pencil" }),
  });
}

function point(x: number, y: number, pressure: number): StrokePoint {
  return {
    x,
    y,
    timestamp: 0,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    delta: { x: 0, y: 0 },
    velocity: 0,
    acceleration: 0,
  };
}

const PRESSURES = Object.freeze({ low: 0.22, medium: 0.55, high: 0.92 });
type PressureName = keyof typeof PRESSURES;

/**
 * Nine shapes, chosen for what each one is the only way to break.
 *
 * A tap is the single-dab envelope. A short run is the first few dabs, where
 * spacing has not settled. A long run crosses a tile boundary. A curve
 * resamples; a tight turn piles dabs up where the direction reverses; a loop
 * closes on its own start. Self-crossing and retrace are the two ways one
 * passage meets another, which is the accumulation rule. A broad scribble is
 * all of it at once, at the width the material is most visible at.
 */
type ShapeName =
  | "tap"
  | "short-straight"
  | "long-straight"
  | "curve"
  | "tight-turn"
  | "loop"
  | "self-crossing"
  | "retrace"
  | "broad-scribble";

function shape(name: ShapeName, pressure: number): StrokePoint[] {
  const points: StrokePoint[] = [];
  switch (name) {
    case "tap":
      points.push(point(150, 150, pressure));
      break;
    case "short-straight":
      for (let index = 0; index < 14; index += 1) {
        points.push(point(100 + index * 1.1, 150, pressure));
      }
      break;
    case "long-straight":
      // Starts in tile 1 and ends in tile 3, so the boundary cells are in it.
      for (let index = 0; index <= 180; index += 1) {
        points.push(point(90 + index * 1.2, 150, pressure));
      }
      break;
    case "curve":
      for (let index = 0; index <= 140; index += 1) {
        const t = (index / 140) * Math.PI * 0.85;
        points.push(point(120 + Math.cos(t) * 70, 180 + Math.sin(t) * 46, pressure));
      }
      break;
    case "tight-turn":
      for (let index = 0; index <= 60; index += 1) {
        points.push(point(110 + index * 1.4, 140, pressure));
      }
      for (let index = 1; index <= 60; index += 1) {
        points.push(point(194 - index * 1.4, 140 + index * 0.12, pressure));
      }
      break;
    case "loop":
      for (let index = 0; index <= 160; index += 1) {
        const t = (index / 160) * Math.PI * 2;
        points.push(point(160 + Math.cos(t) * 38, 160 + Math.sin(t) * 38, pressure));
      }
      break;
    case "self-crossing":
      for (let index = 0; index <= 200; index += 1) {
        const t = (index / 200) * Math.PI * 4;
        points.push(point(150 + Math.sin(t) * 55, 150 + Math.sin(t * 2) * 40, pressure));
      }
      break;
    case "retrace":
      // Out and back along exactly the same line: two passages, one path.
      for (let index = 0; index <= 120; index += 1) {
        const t = index / 120;
        const along = t <= 0.5 ? t * 2 : 2 - t * 2;
        points.push(point(100 + along * 96, 150, pressure));
      }
      break;
    case "broad-scribble":
      for (let index = 0; index <= 300; index += 1) {
        const t = index / 300;
        points.push(
          point(100 + t * 150 + Math.sin(t * 21) * 34, 150 + Math.cos(t * 15) * 44, pressure),
        );
      }
      break;
  }
  return points;
}

function fieldsFor(brush: ResolvedBrushSnapshot): MaterialFieldCache {
  return new MaterialFieldCache(
    resolveMaterialResource(createPencilMaterialProgram(brush).paperResourceId),
  );
}

type Material = ReadonlyMap<MaterialTileKey, CommittedMaterialTile>;

/**
 * Every inked cell of a mark, named by where it is on the page.
 *
 * The count is in the digest string and also reported beside it, so a failure
 * says whether the mark covers different paper or the same paper differently.
 */
function pageDigest(material: Material): string {
  const cells: number[] = [];
  for (const tile of material.values()) {
    for (let index = 0; index < tile.alpha.length; index += 1) {
      const value = tile.alpha[index] ?? 0;
      if (value === 0) continue;
      cells.push(
        tile.ty * TILE_CELLS + Math.floor(index / TILE_CELLS),
        tile.tx * TILE_CELLS + (index % TILE_CELLS),
        value,
      );
    }
  }
  const order: number[] = [];
  for (let index = 0; index < cells.length; index += 3) order.push(index);
  order.sort((left, right) => {
    const dy = (cells[left] ?? 0) - (cells[right] ?? 0);
    if (dy !== 0) return dy;
    return (cells[left + 1] ?? 0) - (cells[right + 1] ?? 0);
  });
  const parts: string[] = [String(order.length)];
  for (const index of order) {
    parts.push(`${String(cells[index])}:${String(cells[index + 1])}:${String(cells[index + 2])}`);
  }
  return `${String(order.length)}/${hash(parts.join("|"))}`;
}

function inkedCells(material: Material): Set<string> {
  const cells = new Set<string>();
  for (const tile of material.values()) {
    for (let index = 0; index < tile.alpha.length; index += 1) {
      if ((tile.alpha[index] ?? 0) === 0) continue;
      const x = tile.tx * TILE_CELLS + (index % TILE_CELLS);
      const y = tile.ty * TILE_CELLS + Math.floor(index / TILE_CELLS);
      cells.add(`${String(x)}:${String(y)}`);
    }
  }
  return cells;
}

/** The cold path: index, program, blank field cache, rebuild. */
function coldMaterial(points: readonly StrokePoint[], brush: ResolvedBrushSnapshot): Material {
  const program = createPencilMaterialProgram(brush);
  return reconstructMaterial(PencilDabIndex.build(points, brush), program, fieldsFor(brush));
}

/** The live path: fed in frames, finalized, handed over. */
function liveAccumulator(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  batch = 7,
): PencilMaterialAccumulator {
  const accumulator = new PencilMaterialAccumulator(brush, fieldsFor(brush));
  const seen: StrokePoint[] = [];
  for (let index = 0; index < points.length; index += batch) {
    for (let offset = index; offset < Math.min(index + batch, points.length); offset += 1) {
      const sample = points[offset];
      if (sample !== undefined) seen.push(sample);
    }
    accumulator.append(seen, false);
  }
  accumulator.append(seen, true);
  return accumulator;
}

interface FrozenFixture {
  readonly label: string;
  readonly shape: ShapeName;
  readonly size: number;
  readonly pressure: PressureName;
}

/**
 * Nine shapes, four sizes, three pressures -- eleven fixtures.
 *
 * Not the cross product. Every shape appears once, every size appears, every
 * pressure appears, and where a shape has a size that matters it gets that one:
 * a tap is frozen at all three of the widths where the envelope reads
 * differently, a broad scribble at the width the material was tuned for, a
 * short run at the width where one dab is a couple of cells across.
 */
const FROZEN: readonly FrozenFixture[] = Object.freeze([
  { label: "tap/2pu/low", shape: "tap", size: 2, pressure: "low" },
  { label: "tap/12pu/medium", shape: "tap", size: 12, pressure: "medium" },
  { label: "tap/26pu/high", shape: "tap", size: 26, pressure: "high" },
  { label: "short-straight/2pu/medium", shape: "short-straight", size: 2, pressure: "medium" },
  { label: "long-straight/6pu/low", shape: "long-straight", size: 6, pressure: "low" },
  { label: "curve/6pu/high", shape: "curve", size: 6, pressure: "high" },
  { label: "tight-turn/12pu/medium", shape: "tight-turn", size: 12, pressure: "medium" },
  { label: "loop/12pu/low", shape: "loop", size: 12, pressure: "low" },
  { label: "self-crossing/6pu/medium", shape: "self-crossing", size: 6, pressure: "medium" },
  { label: "retrace/12pu/high", shape: "retrace", size: 12, pressure: "high" },
  { label: "broad-scribble/26pu/medium", shape: "broad-scribble", size: 26, pressure: "medium" },
]);

/**
 * `pencil@1` with the pressure-size response off, so pressure varies the load
 * and nothing else. Same strategy, same resources, same deposition.
 */
function fixedWidthBrush(size: number): ResolvedBrushSnapshot {
  const base = frozenBrush(size);
  return createResolvedBrushSnapshot({
    schemaVersion: base.schemaVersion,
    presetId: base.presetId,
    presetVersion: base.presetVersion,
    family: base.family,
    color: base.color,
    size: base.size,
    opacity: base.opacity,
    smoothing: base.smoothing,
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: Object.freeze({ kind: "linear", exponent: 1 }),
      }),
      pressureOpacity: base.dynamics.pressureOpacity,
    }),
    renderer: base.renderer,
  });
}

/** Light cells are in medium, medium cells are in firm, and each adds some. */
function expectSupersetChain(brush: ResolvedBrushSnapshot, name: ShapeName): void {
  const cells = (["low", "medium", "high"] as const).map((pressure) =>
    inkedCells(coldMaterial(shape(name, PRESSURES[pressure]), brush)),
  );
  const [light, medium, firm] = cells;
  expect(light?.size).toBeGreaterThan(0);
  expect(medium?.size).toBeGreaterThan(light?.size ?? 0);
  expect(firm?.size).toBeGreaterThan(medium?.size ?? 0);
  for (const cell of light ?? []) expect(medium?.has(cell), `${cell} left medium`).toBe(true);
  for (const cell of medium ?? []) expect(firm?.has(cell), `${cell} left firm`).toBe(true);
}

/** The frozen result of the fixtures whose deposition paths are compared. */
const FROZEN_PATH_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  "tap/12pu/medium": "346/16p79cp",
  "retrace/12pu/high": "5694/l4s5gp",
  "broad-scribble/26pu/medium": "50096/i1xg5t",
});

function fixtureMaterial(fixture: FrozenFixture): Material {
  const brush = frozenBrush(fixture.size);
  return coldMaterial(shape(fixture.shape, PRESSURES[fixture.pressure]), brush);
}

/**
 * Regenerating any expectation in this file to make a failing run pass would
 * defeat the gate. A change here means `pencil@1` draws something other than
 * what the artist approved, and the remedy is `pencil@2` -- a reviewed strategy
 * version, so that artwork already saved keeps resolving the Pencil it was
 * drawn with. There is no circumstance in which one of these moves in place.
 */
describe("frozen pencil@1 material resources", () => {
  it("pins the built-in fields the mark is made of", () => {
    // `pencil-material-resources.test.ts` settles that these are generated the
    // same way twice; what they generate is pinned here, with the resource
    // named, so a failure says which field moved.
    releaseMaterialResources();
    const digests = registeredMaterialResources().map(
      (id) => `${id}:${byteDigest(resolveMaterialResource(id).samples)}`,
    );
    expect(digests).toEqual([
      "folio.graphite.hb-tip.v1:1yig76y",
      "folio.paper.graphite-tooth.v1:1a91iur",
    ]);
  });
});

describe("frozen pencil@1 material output", () => {
  it("pins the graphite every frozen fixture deposits", () => {
    const digests = FROZEN.map(
      (fixture) => `${fixture.label} ${pageDigest(fixtureMaterial(fixture))}`,
    );
    expect(digests).toEqual([
      "tap/2pu/low 4/mildgx",
      "tap/12pu/medium 346/16p79cp",
      "tap/26pu/high 2679/9nj24n",
      "short-straight/2pu/medium 126/sz5vck",
      "long-straight/6pu/low 3686/1nlm47v",
      "curve/6pu/high 4512/12b2qck",
      "tight-turn/12pu/medium 5149/we9ivq",
      "loop/12pu/low 7153/1txnonl",
      "self-crossing/6pu/medium 8954/18qyta2",
      "retrace/12pu/high 5694/l4s5gp",
      "broad-scribble/26pu/medium 50096/i1xg5t",
    ]);
  });

  it("pins the graphite each pressure deposits along one path", () => {
    // Pressure is the one input the artist varies continuously, so the three
    // readings of one shape are frozen on their own rather than left to the
    // single pressure each fixture above happens to use.
    const digests = (["low", "medium", "high"] as const).map((name) => {
      const material = coldMaterial(shape("long-straight", PRESSURES[name]), frozenBrush(12));
      return `long-straight/12pu/${name} ${pageDigest(material)}`;
    });
    expect(digests).toEqual([
      "long-straight/12pu/low 6593/e3xh18",
      "long-straight/12pu/medium 9318/1p5r7yr",
      "long-straight/12pu/high 12046/1f8hbvl",
    ]);
  });

  it("keeps firmer graphite a superset of lighter graphite", () => {
    // Part of the frozen contract and not merely a property of today's
    // deposition: no later optimization may reshuffle grains because pressure
    // changed. Addressed in page space, a firmer pass can only ever add cells.
    //
    // Read on the preset as shipped, this is a coarse instrument and is kept
    // honest about it: a firm tip is nearly twice the radius of a light one, so
    // the wider footprint alone would absorb a displacement of a cell or two
    // without the subset ever breaking. Measured -- a pressure-dependent shift
    // of one and a half cells passes this. It is here because it is the claim
    // about the mark a person draws; the test below is the one with teeth.
    expectSupersetChain(frozenBrush(12), "long-straight");
  });

  it("moves no grain at all when pressure alone changes", () => {
    // The sharp form of the same claim. Hold the footprint still -- a durable
    // snapshot with the size response off, which is a Pencil a person may
    // configure -- and pressure decides only how much graphite lands. Then the
    // grains are page-anchored or they are not, at cell resolution, and a
    // displacement of a single cell breaks the chain. A loop rather than a
    // straight run, because a straight run is its own translate along its
    // length and would hide exactly the defect this is looking for.
    expectSupersetChain(fixedWidthBrush(12), "loop");
  });
});

describe("frozen pencil@1 deposition paths", () => {
  /** The three fixtures with the most ways to differ between paths. */
  const representative = FROZEN.filter((fixture) =>
    ["tap/12pu/medium", "retrace/12pu/high", "broad-scribble/26pu/medium"].includes(fixture.label),
  );

  it.each(representative.map((fixture) => [fixture.label, fixture] as const))(
    "reaches one frozen result live, committed and cold: %s",
    (_label, fixture) => {
      // `pencil-material-cache.test.ts` settles that these three agree with
      // each other. What is settled here is which value they agree *on*: three
      // paths moving together is exactly what a memory optimization does, and
      // internal agreement would not notice it.
      const brush = frozenBrush(fixture.size);
      const points = shape(fixture.shape, PRESSURES[fixture.pressure]);
      const accumulator = liveAccumulator(points, brush);

      const active = new Map<MaterialTileKey, CommittedMaterialTile>();
      for (const key of accumulator.tileKeys()) {
        const tile = accumulator.tile(key);
        if (tile === null) continue;
        active.set(key, { tx: tile.tx, ty: tile.ty, alpha: tile.alpha.slice() });
      }

      const committed = accumulator.commit();
      const cold = reconstructMaterial(committed.index, committed.program, fieldsFor(brush));
      const frozen = pageDigest(cold);

      expect(pageDigest(active)).toBe(frozen);
      expect(pageDigest(committed.tiles)).toBe(frozen);
      expect(frozen).toBe(FROZEN_PATH_DIGESTS[fixture.label]);
    },
  );

  it("reaches the frozen result whatever the tiles are rebuilt in", () => {
    // Reconstruction order, neighbour order, and one tile alone with a field
    // cache of its own -- none of them may reach a different mark. This is what
    // lets the runtime evict whatever it likes, and it is pinned rather than
    // merely self-consistent for the same reason as above.
    const fixture = FROZEN[FROZEN.length - 1];
    expect(fixture).toBeDefined();
    const brush = frozenBrush(fixture?.size ?? 26);
    const points = shape(fixture?.shape ?? "broad-scribble", PRESSURES.medium);
    const program = createPencilMaterialProgram(brush);
    const index = PencilDabIndex.build(points, brush);
    const keys = [...index.tileKeys()];
    expect(keys.length).toBeGreaterThan(2);

    const build = (order: readonly MaterialTileKey[], shared: boolean): Material => {
      const fields = fieldsFor(brush);
      const material = new Map<MaterialTileKey, CommittedMaterialTile>();
      for (const key of order) {
        const tile = reconstructMaterialTile(
          key,
          index,
          program,
          shared ? fields : fieldsFor(brush),
        );
        if (tile !== null) material.set(key, tile);
      }
      return material;
    };

    const frozen = FROZEN_PATH_DIGESTS["broad-scribble/26pu/medium"];
    expect(pageDigest(build(keys, true))).toBe(frozen);
    expect(pageDigest(build([...keys].reverse(), true))).toBe(frozen);
    // Every other tile first, then the ones between them: a tile's gutter
    // neighbours are built after it, and the material is still the same.
    const alternating = [
      ...keys.filter((_, at) => at % 2 === 0),
      ...keys.filter((_, at) => at % 2 === 1),
    ];
    expect(pageDigest(build(alternating, false))).toBe(frozen);
  });

  it("reaches the frozen result whatever frames the samples arrived in", () => {
    // A device delivers samples in whatever batches it likes, and the mark is
    // not allowed to depend on where those batches fell.
    const brush = frozenBrush(12);
    const points = shape("retrace", PRESSURES.high);
    const frozen = FROZEN_PATH_DIGESTS["retrace/12pu/high"];
    for (const batch of [1, 3, 29, points.length]) {
      expect(
        pageDigest(liveAccumulator(points, brush, batch).commit().tiles),
        `batch ${String(batch)}`,
      ).toBe(frozen);
    }
  });
});

describe("frozen pencil@1 presentation border", () => {
  it("pins what a presentation carries beyond its own tile", () => {
    // E4.2E's border rule, as data: a presentation is one cell larger all the
    // way round than the tile it shows, and that ring is the neighbour's, so a
    // bilinear filter asked for a pixel at the edge has a real sample to read.
    // `pencil-material-seam.test.ts` holds the rest -- the device-space
    // placement, the blit's source rect, the four-tile corner, the fractional
    // pan, and active against committed. Pinned here is only the shape of the
    // contract, which no later cache work may change without changing the
    // picture at high zoom.
    const brush = frozenBrush(26);
    const material = coldMaterial(shape("broad-scribble", PRESSURES.medium), brush);
    const keys = [...material.keys()].sort();
    const key = keys[0];
    expect(key).toBeDefined();
    const own = material.get(key ?? "")?.alpha;
    expect(own).toBeDefined();

    const comma = (key ?? "").indexOf(",");
    const tx = Number((key ?? "").slice(0, comma));
    const ty = Number((key ?? "").slice(comma + 1));
    const presentation = assemblePresentationAlpha(
      own ?? new Uint8Array(0),
      (dx, dy) => material.get(`${String(tx + dx)},${String(ty + dy)}`)?.alpha ?? null,
    );

    const size = TILE_CELLS + 2;
    expect(presentation.length).toBe(size * size);
    // The middle is the tile, untouched.
    for (let row = 0; row < TILE_CELLS; row += 1) {
      expect([
        ...presentation.subarray((row + 1) * size + 1, (row + 1) * size + 1 + TILE_CELLS),
      ]).toEqual([
        ...(own ?? new Uint8Array(0)).subarray(row * TILE_CELLS, row * TILE_CELLS + TILE_CELLS),
      ]);
    }
    // The ring is whatever the neighbour has there, and zero where there is no
    // neighbour, which is correct: no graphite is a real answer.
    const right = material.get(`${String(tx + 1)},${String(ty)}`)?.alpha ?? null;
    for (let row = 0; row < TILE_CELLS; row += 1) {
      expect(presentation[(row + 1) * size + size - 1]).toBe(
        right === null ? 0 : (right[row * TILE_CELLS] ?? 0),
      );
    }
    const below = material.get(`${String(tx)},${String(ty + 1)}`)?.alpha ?? null;
    for (let column = 0; column < TILE_CELLS; column += 1) {
      expect(presentation[(size - 1) * size + column + 1]).toBe(
        below === null ? 0 : (below[column] ?? 0),
      );
    }
  });
});

describe("the frozen strategy suite", () => {
  it("accounts for every shipped strategy with a gate that pins its pixels", () => {
    // A strategy may not ship without something in this list. The expectation
    // names the file that pins it, so a failure here says which strategy
    // arrived -- or which gate went missing -- rather than only that a count
    // changed.
    const gates: Readonly<Record<string, string>> = Object.freeze({
      "centerline@1": "legacy-strategy-freeze.test.ts",
      "outline@1": "legacy-strategy-freeze.test.ts",
      "technical-pen@1": "engine-strategy-freeze.test.ts",
      "pressure-pen@1": "engine-strategy-freeze.test.ts",
      "pencil@1": "engine-strategy-freeze.test.ts + pencil-visual-freeze.test.ts",
    });
    const roster = supportedBrushStrategies().map(
      (identity) => `${identity} -> ${gates[identity] ?? "UNGATED"}`,
    );
    expect(roster).toEqual([
      "centerline@1 -> legacy-strategy-freeze.test.ts",
      "outline@1 -> legacy-strategy-freeze.test.ts",
      "pencil@1 -> engine-strategy-freeze.test.ts + pencil-visual-freeze.test.ts",
      "pressure-pen@1 -> engine-strategy-freeze.test.ts",
      "technical-pen@1 -> engine-strategy-freeze.test.ts",
    ]);
  });
});
