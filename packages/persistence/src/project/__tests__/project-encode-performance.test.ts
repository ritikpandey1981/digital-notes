import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@folio/domain";
import {
  Layer,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  SketchbookDocument,
  createPagePaper,
  type PageObject,
} from "@folio/document";
import {
  StrokeBuilder,
  StrokeSmoother,
  createResolvedBrushSnapshot,
  type ResolvedBrushSnapshot,
  type Stroke,
  type StrokePointInput,
} from "@folio/ink";
import { buildFolioProjectTree, encodeFolioProject } from "../project-codec";
import { canonicalizeJsonValue } from "../../json";
import { assertEncodableProjectTree } from "../project-validation";
import type { FolioProjectSnapshot } from "../project-types";

/**
 * What encoding a project costs, by document size.
 *
 * This runs on the renderer's main thread during a recovery capture, so its
 * cost is a responsiveness budget rather than a throughput one. Recovery R1
 * stopped a capture from starting while someone is drawing; this measures the
 * capture itself, which still has to finish before the next frame can be
 * anything other than late.
 *
 * It asserts nothing about wall-clock time. Timings move with the machine and
 * with whatever else it is doing, so a budget asserted here would either be too
 * loose to catch a regression or too tight to stay green. What it does instead
 * is report, repeatably: every fixture is encoded several times and the median
 * is taken, because one run of a thirty-megabyte encode is mostly a measurement
 * of when the collector happened to run.
 *
 * Opt in with `FOLIO_CODEC_PERFORMANCE=1`. The artifact lands in
 * `test-results/recovery-codec/` and is gitignored.
 */

const ENABLED = process.env.FOLIO_CODEC_PERFORMANCE === "1";
const OUTPUT = path.resolve("test-results/recovery-codec");
const REPEATS = Number(process.env.FOLIO_CODEC_REPEATS ?? "5");
const LABEL = process.env.FOLIO_CODEC_LABEL ?? "after";

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function brush(): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "perf-pencil",
    presetVersion: 1,
    family: "pencil",
    color: "#343434",
    size: 26,
    opacity: 0.78,
    smoothing: { mode: "average", amount: 0.2 },
    dynamics: {
      pressureSize: { enabled: true, minimumFactor: 0.65, maximumFactor: 1.25, curve: LINEAR },
      pressureOpacity: {
        enabled: true,
        minimumFactor: 0.45,
        maximumFactor: 1,
        curve: { kind: "power", exponent: 0.75 },
      },
    },
    renderer: { version: 1, kind: "pencil" },
  });
}

function stroke(id: string, samples: number): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush: brush(),
    smoother: new StrokeSmoother({ mode: "average" }),
  });
  for (let index = 0; index < samples; index += 1) {
    const t = index / samples;
    const input: StrokePointInput = {
      x: 100 + Math.sin(t * 11) * 160 + t * 520,
      y: 200 + Math.cos(t * 7) * 110,
      timestamp: index * 4,
      pressure: 0.3 + 0.5 * Math.abs(Math.sin(t * 5)),
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    };
    builder.addPoint(input);
  }
  return builder.finalize();
}

function project(strokes: number, samples: number): FolioProjectSnapshot {
  const factory = new ObjectFactory({ now: () => "2026-10-11T00:00:00.000Z" });
  const objects: PageObject[] = [];
  for (let index = 0; index < strokes; index += 1) {
    objects.push(
      factory.createInkObject({
        id: `object-${String(index)}`,
        stroke: stroke(`stroke-${String(index)}`, samples),
        createdAt: "2026-10-11T00:00:00.000Z",
        zIndex: index,
      }),
    );
  }
  const page = new Page({
    id: "page-1",
    paper: createPagePaper({ type: "blank" }),
    content: new PageDocument({
      layers: [
        new Layer({
          id: "layer-1",
          name: "Layer 1",
          objectIds: objects.map((object) => object.id),
        }),
      ],
      objects: new ObjectCollection(objects),
    }),
  });
  return {
    metadata: { documentId: "perf", title: "perf", createdAt: "2026-10-11T00:00:00.000Z" },
    sketchbook: new SketchbookDocument({ pages: [page] }),
  } as unknown as FolioProjectSnapshot;
}

function millis(run: () => void): number {
  const started = performance.now();
  run();
  return Number((performance.now() - started).toFixed(2));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number((((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2).toFixed(2))
    : (sorted[middle] ?? 0);
}

interface Row {
  readonly label: string;
  readonly samples: number;
  readonly jsonMb: number;
  readonly totalMedianMs: number;
  readonly totalMinMs: number;
  readonly totalMaxMs: number;
  readonly runs: readonly number[];
  /**
   * Building the document the encoder writes, which includes proving every
   * Stroke in it is encodable. This was the dominant stage until Recovery R3,
   * when the codec stopped re-parsing the object it had just built.
   */
  readonly treeBuildMs: number;
  /** Stages measured on the tree the codec itself built, in encoder order. */
  readonly walkMs: number;
  readonly stringifyMs: number;
  readonly byteCountMs: number;
  /** What a whole-tree canonical rebuild would cost, which the codec no longer pays. */
  readonly rebuildMs: number;
  /** Whatever the total is that the measured stages do not account for. */
  readonly remainderMs: number;
  readonly msPerSample: number;
}

function measure(label: string, strokes: number, samples: number): Row {
  const snapshot = project(strokes, samples);
  // Warm the codec so the first fixture is not paying for its own compilation.
  const warm = encodeFolioProject(snapshot);
  const runs: number[] = [];
  for (let attempt = 0; attempt < REPEATS; attempt += 1) {
    runs.push(millis(() => encodeFolioProject(snapshot)));
  }
  const treeBuildMs = median(
    Array.from({ length: REPEATS }, () => millis(() => void buildFolioProjectTree(snapshot))),
  );
  // Measured on the tree the codec built, not on one parsed back from the text:
  // the two hold the same values but not the same object layouts, and the
  // stages after the build run on the former.
  const tree = buildFolioProjectTree(snapshot) as unknown as JsonValue;
  const walkMs = median(
    Array.from({ length: REPEATS }, () => millis(() => assertEncodableProjectTree(tree))),
  );
  const stringifyMs = median(
    Array.from({ length: REPEATS }, () => millis(() => void JSON.stringify(tree, null, 2))),
  );
  const byteCountMs = median(
    Array.from({ length: REPEATS }, () =>
      millis(() => void new TextEncoder().encode(warm).byteLength),
    ),
  );
  // Measured but not performed: the pass the codec used to make over the whole
  // document to put every object's keys in order, before it learned to emit
  // them that way. Kept here so the saving stays visible rather than becoming
  // a number in a commit message.
  const rebuildMs = median(
    Array.from({ length: REPEATS }, () => millis(() => void canonicalizeJsonValue(tree))),
  );
  const total = median(runs);
  return {
    label,
    samples: strokes * samples,
    jsonMb: Number((new TextEncoder().encode(warm).byteLength / 1048576).toFixed(2)),
    totalMedianMs: total,
    totalMinMs: Math.min(...runs),
    totalMaxMs: Math.max(...runs),
    runs,
    treeBuildMs,
    walkMs,
    stringifyMs,
    byteCountMs,
    rebuildMs,
    remainderMs: Number((total - treeBuildMs - walkMs - stringifyMs - byteCountMs).toFixed(2)),
    msPerSample: Number((total / (strokes * samples)).toFixed(4)),
  };
}

describe.skipIf(!ENABLED)("what encoding a project costs", () => {
  it("reports the cost by document size", () => {
    const rows = [
      measure("ordinary", 6, 220),
      measure("1x5000", 1, 5000),
      measure("2x5000", 2, 5000),
      measure("3x5000", 3, 5000),
      measure("5x5000", 5, 5000),
      measure("7x5000", 7, 5000),
    ];
    mkdirSync(OUTPUT, { recursive: true });
    writeFileSync(
      path.join(OUTPUT, `${LABEL}.json`),
      `${JSON.stringify({ recordedAt: new Date().toISOString(), repeats: REPEATS, rows }, null, 2)}\n`,
      "utf8",
    );
    for (const row of rows) {
      console.log(
        `${row.label.padEnd(9)} ${String(row.samples).padStart(6)} samples  ${String(row.jsonMb).padStart(6)} MB  ` +
          `median ${String(row.totalMedianMs).padStart(8)} ms  [${String(row.totalMinMs)}..${String(row.totalMaxMs)}]  ` +
          `build ${String(row.treeBuildMs).padStart(7)}  walk ${String(row.walkMs).padStart(7)}  ` +
          `stringify ${String(row.stringifyMs).padStart(7)}  ` +
          `bytes ${String(row.byteCountMs).padStart(6)}  remainder ${String(row.remainderMs).padStart(8)}  ` +
          `(rebuild avoided ${String(row.rebuildMs)})  ` +
          `${String(row.msPerSample)} ms/sample`,
      );
    }
    expect(rows).toHaveLength(6);
  }, 1_800_000);
});
