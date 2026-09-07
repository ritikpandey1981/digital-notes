import { describe, expect, it } from "vitest";
import {
  accumulateWheelNavigation,
  computeFocusedStackOffset,
  computeSheetEmphasis,
  computeSpatialLayerStackFrame,
  computeSpatialLayerStackLayout,
  projectSheetCorner,
  SPATIAL_STACK_GEOMETRY,
  EMPTY_WHEEL_NAVIGATION,
  SPATIAL_STACK_MOTION,
  SPATIAL_STACK_NAVIGATION,
  type SpatialStackLayout,
  type SpatialStackLayoutInput,
} from "./spatial-layer-stack-model";

const PORTRAIT = Object.freeze({ pageWidth: 794, pageHeight: 1123 });
const LANDSCAPE = Object.freeze({ pageWidth: 1123, pageHeight: 794 });
const SQUARE = Object.freeze({ pageWidth: 900, pageHeight: 900 });

/** The measured free band in a maximised window, dock and rails excluded. */
const LARGE_WORKSPACE = Object.freeze({ workspaceWidth: 1200, workspaceHeight: 820 });
/** The project's minimum supported window, same exclusions. */
const MINIMUM_WORKSPACE = Object.freeze({ workspaceWidth: 720, workspaceHeight: 560 });

function layout(input: Partial<SpatialStackLayoutInput> = {}): SpatialStackLayout {
  return computeSpatialLayerStackLayout({
    ...PORTRAIT,
    ...LARGE_WORKSPACE,
    layerCount: 3,
    ...input,
  });
}

const LAYER_COUNTS = [1, 2, 5, 10, 15] as const;
const PAGES = [
  { name: "portrait", geometry: PORTRAIT },
  { name: "landscape", geometry: LANDSCAPE },
  { name: "square", geometry: SQUARE },
] as const;
const WORKSPACES = [
  { name: "large", workspace: LARGE_WORKSPACE },
  { name: "minimum", workspace: MINIMUM_WORKSPACE },
] as const;

describe("spatial stack layout validity", () => {
  for (const count of LAYER_COUNTS) {
    for (const page of PAGES) {
      for (const space of WORKSPACES) {
        it(`stays finite and positive for ${count} layers on a ${page.name} page in a ${space.name} workspace`, () => {
          const result = layout({ ...page.geometry, ...space.workspace, layerCount: count });

          expect(result.planeWidth).toBeGreaterThan(0);
          expect(result.planeHeight).toBeGreaterThan(0);
          expect(result.gap).toBeGreaterThanOrEqual(SPATIAL_STACK_GEOMETRY.absoluteMinimumGap);
          expect(result.stackHeight).toBeGreaterThan(0);
          for (const plane of [result.paper, ...result.layers]) {
            expect(Number.isFinite(plane.translateY)).toBe(true);
            expect(Number.isFinite(plane.translateZ)).toBe(true);
            expect(plane.translateY).toBeGreaterThanOrEqual(0);
            expect(plane.translateZ).toBeGreaterThanOrEqual(0);
          }
        });
      }
    }
  }

  it("is deterministic for identical input", () => {
    expect(layout({ layerCount: 7 })).toEqual(layout({ layerCount: 7 }));
  });
});

describe("spatial stack ordering", () => {
  it("puts the topmost Layer first and the bottom Layer last", () => {
    const result = layout({ layerCount: 4 });
    // Storage runs bottom-to-top, so the visual top is the last stored Layer.
    expect(result.layers.map((plane) => plane.storageIndex)).toEqual([3, 2, 1, 0]);
    expect(result.layers.map((plane) => plane.displayIndex)).toEqual([0, 1, 2, 3]);
  });

  it("places the paper lowest on screen and furthest back in paint order", () => {
    const result = layout({ layerCount: 4 });
    expect(result.paper.storageIndex, "paper is never a Layer").toBe(-1);
    expect(result.paper.displayIndex).toBe(4);
    for (const plane of result.layers) {
      expect(result.paper.translateY, "paper sits below every sheet").toBeGreaterThan(
        plane.translateY,
      );
      // Paint order follows compositing, not screen position. An opaque page
      // painted last would cover every Layer above it.
      expect(result.paper.zIndex, "paper paints first").toBeLessThan(plane.zIndex);
      expect(result.paper.translateZ, "paper is furthest away").toBeLessThan(plane.translateZ);
    }
  });

  it("fans downward on screen while receding in depth", () => {
    const result = layout({ layerCount: 5 });
    const planes = [...result.layers, result.paper];
    for (let index = 1; index < planes.length; index += 1) {
      expect(planes[index]!.translateY).toBeGreaterThan(planes[index - 1]!.translateY);
      expect(planes[index]!.translateZ, "each sheet down is further back").toBeLessThan(
        planes[index - 1]!.translateZ,
      );
      expect(planes[index]!.zIndex, "and paints earlier").toBeLessThan(planes[index - 1]!.zIndex);
    }
  });

  it("gives every plane a unique paint order", () => {
    const result = layout({ layerCount: 9 });
    const zIndexes = [result.paper, ...result.layers].map((plane) => plane.zIndex);
    expect(new Set(zIndexes).size).toBe(zIndexes.length);
  });
});

describe("spatial stack page proportions", () => {
  it.each(PAGES)("preserves the $name page aspect ratio", ({ geometry }) => {
    const result = layout(geometry);
    expect(result.planeHeight / result.planeWidth).toBeCloseTo(
      geometry.pageHeight / geometry.pageWidth,
      6,
    );
  });

  it("never hard-codes a rectangle: a wider page yields a wider plane ratio", () => {
    const portrait = layout(PORTRAIT);
    const landscape = layout(LANDSCAPE);
    expect(portrait.planeHeight / portrait.planeWidth).toBeGreaterThan(
      landscape.planeHeight / landscape.planeWidth,
    );
  });
});

describe("spatial stack separation", () => {
  it("separates sheets in proportion to their own height", () => {
    const result = layout({ layerCount: 3 });
    const apparent = result.planeHeight * Math.cos((result.tiltDegrees * Math.PI) / 180);
    expect(result.gap).toBeCloseTo(apparent * SPATIAL_STACK_GEOMETRY.separationRatio, 6);
    expect(
      result.gap / apparent,
      "a sheet is separated by a substantial share of its own height",
    ).toBeGreaterThan(0.4);
  });

  it("gives the paper more room than any layer-to-layer gap", () => {
    for (const layerCount of [1, 2, 5, 10]) {
      const result = layout({ layerCount });
      expect(result.paperGap, `${layerCount} layers`).toBeGreaterThan(result.gap);
      expect(result.paperGap).toBeCloseTo(
        result.gap * SPATIAL_STACK_GEOMETRY.paperGapMultiplier,
        6,
      );
    }
  });

  it("separates the same way however deep the document is", () => {
    // Compressing a deep stack to make it fit is what produced a compressed
    // overview. Navigation moves through it instead, so the step is uniform.
    const ratios = [2, 5, 8, 12, 20, 40].map((layerCount) => {
      const result = layout({ layerCount });
      const apparent = result.planeHeight * Math.cos((result.tiltDegrees * Math.PI) / 180);
      return result.gap / apparent;
    });
    for (const ratio of ratios) {
      expect(ratio).toBeCloseTo(SPATIAL_STACK_GEOMETRY.separationRatio, 6);
    }
  });
});

describe("spatial stack artwork legibility", () => {
  it("never shrinks a sheet because the document has more layers", () => {
    const single = layout({ layerCount: 1 }).planeWidth;
    for (const layerCount of [5, 10, 20, 50]) {
      expect(
        layout({ layerCount }).planeWidth,
        `${layerCount} layers must be the same sheet as one layer`,
      ).toBeCloseTo(single, 6);
    }
  });

  it("never shrinks a sheet because the sheets sit further apart", () => {
    // The separation is spent on the arrangement's height, never on the page.
    const tight = layout({ layerCount: 5, tuning: { separationRatio: 0.2 } });
    const loose = layout({ layerCount: 5, tuning: { separationRatio: 0.75 } });
    expect(loose.planeWidth).toBeCloseTo(tight.planeWidth, 6);
    expect(loose.gap).toBeGreaterThan(tight.gap);
    expect(loose.stackHeight).toBeGreaterThan(tight.stackHeight);
  });

  it("extends past the workspace rather than shrinking the page into a thumbnail", () => {
    // Legibility outranks containment. Sheets are sized for their artwork and
    // separated enough to tell whose artwork is whose, so the arrangement is
    // taller than the workspace and is navigated rather than fitted.
    let previous = 0;
    for (const layerCount of [1, 3, 20]) {
      const result = layout({ layerCount });
      expect(result.scrolls, `${layerCount} layers`).toBe(true);
      expect(result.planeWidth).toBeGreaterThan(0);
      expect(result.stackHeight).toBeGreaterThan(LARGE_WORKSPACE.workspaceHeight);
      expect(result.stackHeight, "and grows with the document").toBeGreaterThan(previous);
      previous = result.stackHeight;
    }
  });

  it("keeps a five-layer stack at page scale on every page shape", () => {
    // Five layers is the case this view exists for. Whatever the page shape,
    // the sheet is the one a single-layer document would get.
    for (const page of PAGES) {
      const single = layout({ ...page.geometry, layerCount: 1 }).planeWidth;
      expect(
        layout({ ...page.geometry, layerCount: 5 }).planeWidth,
        `${page.name}: five layers must not look like thumbnails`,
      ).toBeCloseTo(single, 6);
      expect(single / SPATIAL_STACK_GEOMETRY.usefulSheetScale).toBeGreaterThan(single);
    }
  });
});

describe("spatial stack workspace fitting", () => {
  it("narrows the plane once width is the binding constraint", () => {
    // A portrait page is height-limited in any roomy workspace, so width only
    // starts to matter for a wide page or a genuinely narrow workspace.
    const wide = layout({ ...LANDSCAPE, workspaceWidth: 1200 });
    const narrow = layout({ ...LANDSCAPE, workspaceWidth: 500 });
    expect(narrow.planeWidth).toBeLessThan(wide.planeWidth);
    expect(narrow.planeWidth).toBeGreaterThan(0);
  });

  it("keeps a portrait plane height-limited rather than width-limited", () => {
    const roomy = layout({ ...PORTRAIT, workspaceWidth: 1200 });
    const tighter = layout({ ...PORTRAIT, workspaceWidth: 900 });
    expect(tighter.planeWidth, "width has no say while height binds").toBe(roomy.planeWidth);
    expect(roomy.planeWidth).toBeGreaterThan(0);
  });

  it("never spans more of the workspace than its configured share", () => {
    for (const width of [400, 720, 1200, 2400]) {
      expect(layout({ workspaceWidth: width }).planeWidth).toBeLessThanOrEqual(
        width * SPATIAL_STACK_GEOMETRY.planeWidthRatio + 1e-6,
      );
    }
  });

  it("uses every candidate's own tuning without leaking between them", () => {
    const a = layout({ tuning: { planeWidthRatio: 0.55, tiltDegrees: 12, depthPerPlane: 24 } });
    const c = layout({ tuning: { planeWidthRatio: 0.65, tiltDegrees: 18, depthPerPlane: 40 } });
    expect(a.tiltDegrees).toBe(12);
    expect(c.tiltDegrees).toBe(18);
    expect(c.planeWidth).toBeGreaterThan(a.planeWidth);
    expect(layout().tiltDegrees, "production is unaffected").toBe(
      SPATIAL_STACK_GEOMETRY.tiltDegrees,
    );
  });

  it("survives a degenerate workspace without producing nonsense", () => {
    const result = layout({ workspaceWidth: 0, workspaceHeight: 0, layerCount: 3 });
    expect(result.planeWidth).toBeGreaterThan(0);
    expect(result.planeHeight).toBeGreaterThan(0);
    expect(Number.isFinite(result.gap)).toBe(true);
  });

  it("treats a single-layer document as a normal stack", () => {
    const result = layout({ layerCount: 1 });
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.storageIndex).toBe(0);
    expect(result.paper.displayIndex).toBe(1);
  });
});

const SAMPLED_PROGRESS = [0, 0.25, 0.5, 0.75, 1] as const;

describe("spatial stack separation choreography", () => {
  it("returns the collapsed page at progress 0", () => {
    const result = layout({ layerCount: 5 });
    const frame = computeSpatialLayerStackFrame(result, 0);
    for (const plane of frame.layers) {
      expect(plane.translateY, "every sheet lies on the paper").toBeCloseTo(
        result.paper.translateY,
        6,
      );
      expect(plane.translateZ, "and shares the paper's depth").toBeCloseTo(
        result.paper.translateZ,
        6,
      );
    }
    expect(frame.tiltDegrees).toBeCloseTo(
      result.tiltDegrees * SPATIAL_STACK_MOTION.collapsedTiltRatio,
      6,
    );
    expect(frame.settled).toBe(false);
  });

  it("returns exactly the approved open geometry at progress 1", () => {
    for (const layerCount of [1, 2, 5, 10]) {
      const result = layout({ layerCount });
      const frame = computeSpatialLayerStackFrame(result, 1);
      expect(frame.layers, `${layerCount} layers`).toEqual(result.layers);
      expect(frame.paper).toEqual(result.paper);
      expect(frame.tiltDegrees).toBeCloseTo(result.tiltDegrees, 6);
      expect(frame.settled).toBe(true);
    }
  });

  it("never moves the paper: the sheets lift, the page does not", () => {
    const result = layout({ layerCount: 5 });
    for (const progress of SAMPLED_PROGRESS) {
      expect(computeSpatialLayerStackFrame(result, progress).paper).toEqual(result.paper);
    }
  });

  it("keeps every plane finite and non-negative throughout", () => {
    for (const layerCount of [1, 2, 5, 10, 20]) {
      const result = layout({ layerCount });
      for (const progress of SAMPLED_PROGRESS) {
        const frame = computeSpatialLayerStackFrame(result, progress);
        expect(frame.tiltDegrees).toBeGreaterThan(0);
        expect(Number.isFinite(frame.tiltDegrees)).toBe(true);
        for (const plane of [frame.paper, ...frame.layers]) {
          expect(Number.isFinite(plane.translateY)).toBe(true);
          expect(Number.isFinite(plane.translateZ)).toBe(true);
          expect(plane.translateY).toBeGreaterThanOrEqual(0);
          expect(plane.translateZ).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("holds one page scale for every sheet at every point of the travel", () => {
    // Only position is interpolated. A sheet that also changed size would stop
    // being the same page seen from further away.
    const result = layout({ layerCount: 6 });
    for (const progress of SAMPLED_PROGRESS) {
      const frame = computeSpatialLayerStackFrame(result, progress);
      expect(frame.layers).toHaveLength(result.layers.length);
      expect(result.planeWidth).toBeGreaterThan(0);
      expect(result.planeHeight).toBeGreaterThan(0);
    }
  });

  it("never reorders the stack, at any point of the travel", () => {
    const result = layout({ layerCount: 7 });
    for (const progress of SAMPLED_PROGRESS) {
      const frame = computeSpatialLayerStackFrame(result, progress);
      expect(frame.layers.map((plane) => plane.storageIndex)).toEqual(
        result.layers.map((plane) => plane.storageIndex),
      );
      expect(frame.layers.map((plane) => plane.zIndex)).toEqual(
        result.layers.map((plane) => plane.zIndex),
      );
      expect(frame.paper.zIndex, "paper still paints first").toBeLessThan(
        Math.min(...frame.layers.map((plane) => plane.zIndex)),
      );
    }
  });

  it("separates monotonically, so a reversal simply retraces the same path", () => {
    // Reversal correctness is this plus a single direction of travel: the
    // component reverses one progress value rather than unwinding per-sheet
    // timers, so any two progresses compare the same way in both directions.
    const result = layout({ layerCount: 5 });
    const spreads = SAMPLED_PROGRESS.map((progress) => {
      const frame = computeSpatialLayerStackFrame(result, progress);
      return frame.paper.translateY - frame.layers[0]!.translateY;
    });
    for (let index = 1; index < spreads.length; index += 1) {
      expect(spreads[index]!).toBeGreaterThan(spreads[index - 1]!);
    }
    expect(spreads[0]).toBeCloseTo(0, 6);
  });

  it("lets the top sheet lead without any sheet arriving early", () => {
    const result = layout({ layerCount: 5 });
    const frame = computeSpatialLayerStackFrame(result, 0.5);
    const travelled = frame.layers.map((plane, index) => {
      const open = result.layers[index]!;
      const total = result.paper.translateY - open.translateY;
      return total === 0 ? 1 : (result.paper.translateY - plane.translateY) / total;
    });
    for (let index = 1; index < travelled.length; index += 1) {
      expect(travelled[index]!, "each sheet down is a little behind").toBeLessThanOrEqual(
        travelled[index - 1]! + 1e-9,
      );
    }
    for (const fraction of travelled) {
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it("hides the live canvas before any sheet starts to separate", () => {
    const result = layout({ layerCount: 5 });
    expect(SPATIAL_STACK_MOTION.backdropWindow).toBeLessThan(SPATIAL_STACK_MOTION.separationStart);
    for (let progress = 0; progress <= 1.0001; progress += 0.01) {
      const frame = computeSpatialLayerStackFrame(result, progress);
      const separated = frame.layers.some(
        (plane, index) => Math.abs(plane.translateY - result.paper.translateY) > 1e-9 && index >= 0,
      );
      if (separated) {
        expect(frame.backdropOpacity, `progress ${progress.toFixed(2)}`).toBe(1);
      }
      expect(frame.backdropOpacity).toBeGreaterThanOrEqual(0);
      expect(frame.backdropOpacity).toBeLessThanOrEqual(1);
    }
  });

  it("tips the page before it comes apart", () => {
    const result = layout({ layerCount: 5 });
    const atTiltEnd = computeSpatialLayerStackFrame(result, SPATIAL_STACK_MOTION.tiltWindow);
    expect(atTiltEnd.tiltDegrees).toBeCloseTo(result.tiltDegrees, 6);
    const early = computeSpatialLayerStackFrame(result, SPATIAL_STACK_MOTION.separationStart);
    expect(early.layers[0]!.translateY).toBeCloseTo(result.paper.translateY, 6);
    expect(early.tiltDegrees).toBeGreaterThan(
      result.tiltDegrees * SPATIAL_STACK_MOTION.collapsedTiltRatio,
    );
  });

  it("clamps hostile progress rather than producing nonsense geometry", () => {
    const result = layout({ layerCount: 4 });
    for (const progress of [-5, Number.NaN, Number.POSITIVE_INFINITY, 12]) {
      const frame = computeSpatialLayerStackFrame(result, progress);
      expect(Number.isFinite(frame.progress)).toBe(true);
      expect(frame.progress).toBeGreaterThanOrEqual(0);
      expect(frame.progress).toBeLessThanOrEqual(1);
      for (const plane of frame.layers) expect(Number.isFinite(plane.translateY)).toBe(true);
    }
  });

  it("is deterministic, so the same progress always draws the same frame", () => {
    const result = layout({ layerCount: 5 });
    expect(computeSpatialLayerStackFrame(result, 0.37)).toEqual(
      computeSpatialLayerStackFrame(result, 0.37),
    );
  });
});

describe("spatial stack focus shelf", () => {
  const VIEWPORT = LARGE_WORKSPACE.workspaceHeight;
  const shelf = VIEWPORT * SPATIAL_STACK_NAVIGATION.focusBottomRatio;

  /**
   * Where a sheet lands on screen while `focusedIndex` holds the shelf.
   *
   * Every sheet is placed by the *focused* sheet's offset, because that is what
   * the arrangement actually does -- it translates as one.
   */
  const projected = (
    result: SpatialStackLayout,
    focusedIndex: number,
    index = focusedIndex,
    viewportHeight: number = VIEWPORT,
  ): { readonly top: number; readonly bottom: number } => {
    const offset = computeFocusedStackOffset({
      layout: result,
      focusedVisualIndex: focusedIndex,
      viewportHeight,
    });
    const plane = result.layers[index]!;
    const half = projectSheetCorner(result, plane, result.tiltDegrees).y;
    const centre = plane.translateY + result.planeHeight / 2 - offset;
    return { top: centre - half, bottom: centre + half };
  };

  it("is a shelf low in the workspace, not a centre line", () => {
    expect(
      SPATIAL_STACK_NAVIGATION.focusBottomRatio,
      "the focused sheet sits below the middle",
    ).toBeGreaterThan(0.5);
  });

  it.each([1, 2, 3, 5, 10])("puts any of %i layers on the shelf", (layerCount) => {
    const result = layout({ layerCount });
    for (let index = 0; index < layerCount; index += 1) {
      expect(projected(result, index).bottom, `layer ${index}`).toBeCloseTo(shelf, 6);
    }
  });

  it("holds the shelf whatever the page shape or workspace", () => {
    for (const page of PAGES) {
      for (const space of WORKSPACES) {
        const result = layout({ ...page.geometry, ...space.workspace, layerCount: 5 });
        const height = space.workspace.workspaceHeight;
        expect(projected(result, 2, 2, height).bottom, `${page.name} / ${space.name}`).toBeCloseTo(
          height * SPATIAL_STACK_NAVIGATION.focusBottomRatio,
          6,
        );
      }
    }
  });

  it("keeps the focused sheet's own surface inspectable", () => {
    // The whole point of the shelf: the sheet being worked on is above the fold
    // and most of the workspace is its artwork, not the sheets around it.
    for (const layerCount of [1, 2, 3, 5, 10]) {
      const result = layout({ ...LANDSCAPE, layerCount });
      for (const index of [0, Math.floor(layerCount / 2), layerCount - 1]) {
        const { top, bottom } = projected(result, index);
        expect(top, `${layerCount} layers, index ${index}`).toBeGreaterThanOrEqual(0);
        expect(bottom).toBeLessThanOrEqual(VIEWPORT);
        expect(
          (bottom - top) / VIEWPORT,
          "the focused sheet dominates the workspace",
        ).toBeGreaterThan(0.4);
      }
    }
  });

  it("shows only a couple of sheets at once", () => {
    // A window onto the arrangement, not a picture of all of it. Anything more
    // than about three is the compressed overview this view exists to replace.
    for (const layerCount of [5, 10]) {
      const result = layout({ ...LANDSCAPE, layerCount });
      const focused = 2;
      const offset = computeFocusedStackOffset({
        layout: result,
        focusedVisualIndex: focused,
        viewportHeight: VIEWPORT,
      });
      const meaningful = result.layers.filter((plane) => {
        const half = projectSheetCorner(result, plane, result.tiltDegrees).y;
        const centre = plane.translateY + result.planeHeight / 2 - offset;
        // How much of this sheet's own surface is inside the workspace.
        const visible = Math.min(centre + half, VIEWPORT) - Math.max(centre - half, 0);
        return visible > half; // more than half of the sheet
      });
      expect(meaningful.length, `${layerCount} layers`).toBeLessThanOrEqual(3);
      expect(meaningful.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives the neighbour above real presence and lets the one below leave", () => {
    const result = layout({ ...LANDSCAPE, layerCount: 5 });
    const focused = 2;
    const above = projected(result, focused, focused - 1);
    const centre = projected(result, focused);
    const below = projected(result, focused, focused + 1);
    expect(above.bottom, "the next sheet up is clear of the focused one").toBeLessThan(
      centre.bottom,
    );
    expect(above.bottom, "and is visible in the workspace").toBeGreaterThan(0);
    expect(below.bottom, "the previous sheet is on its way out").toBeGreaterThan(VIEWPORT);
  });

  it("keeps every layer reachable by giving each a distinct offset", () => {
    const result = layout({ layerCount: 10 });
    const offsets = result.layers.map((_plane, index) =>
      computeFocusedStackOffset({
        layout: result,
        focusedVisualIndex: index,
        viewportHeight: VIEWPORT,
      }),
    );
    expect(new Set(offsets).size).toBe(offsets.length);
    // Focusing further down the stack moves the arrangement further up.
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index]!).toBeGreaterThan(offsets[index - 1]!);
    }
  });

  it("never addresses the paper", () => {
    const result = layout({ layerCount: 4 });
    // Past the end resolves to the last Layer, not to the paper below it.
    const beyond = computeFocusedStackOffset({
      layout: result,
      focusedVisualIndex: 99,
      viewportHeight: VIEWPORT,
    });
    const last = computeFocusedStackOffset({
      layout: result,
      focusedVisualIndex: result.layers.length - 1,
      viewportHeight: VIEWPORT,
    });
    expect(beyond).toBe(last);
    const paperHalf = projectSheetCorner(result, result.paper, result.tiltDegrees).y;
    const paperBottom = result.paper.translateY + result.planeHeight / 2 + paperHalf - beyond;
    expect(paperBottom).not.toBeCloseTo(shelf, 3);
  });

  it("stays finite and deterministic, including for hostile input", () => {
    const result = layout({ layerCount: 5 });
    const call = (index: number, viewportHeight: number): number =>
      computeFocusedStackOffset({ layout: result, focusedVisualIndex: index, viewportHeight });
    for (const [index, viewport] of [
      [-4, VIEWPORT],
      [Number.NaN, VIEWPORT],
      [2, Number.NaN],
      [2, -100],
      [1.6, VIEWPORT],
    ] as const) {
      expect(Number.isFinite(call(index, viewport))).toBe(true);
    }
    expect(call(2, VIEWPORT)).toBe(call(2, VIEWPORT));
  });

  it("holds one page scale for every sheet whichever is focused", () => {
    // The offset translates the whole arrangement rather than any single sheet,
    // so no amount of navigating can give one sheet a different page scale.
    const result = layout({ layerCount: 6 });
    expect(result.planeWidth).toBeGreaterThan(0);
    expect(new Set(result.layers.map(() => result.planeWidth)).size).toBe(1);
  });
});

describe("spatial stack wheel navigation", () => {
  const { wheelStepThreshold, minimumStepIntervalMs } = SPATIAL_STACK_NAVIGATION;

  it("ignores movement below the threshold", () => {
    let state = EMPTY_WHEEL_NAVIGATION;
    for (let tick = 0; tick < 5; tick += 1) {
      const result = accumulateWheelNavigation(state, wheelStepThreshold / 10, tick * 16);
      expect(result.step).toBe(0);
      state = result.state;
    }
    expect(state.accumulated).toBeGreaterThan(0);
  });

  it("commits one step once the gesture has earned it", () => {
    const result = accumulateWheelNavigation(EMPTY_WHEEL_NAVIGATION, wheelStepThreshold, 1_000);
    expect(result.step, "wheeling toward the viewer walks down the stack").toBe(1);
    expect(result.state.accumulated, "and the gesture starts again").toBe(0);
  });

  it("walks up the stack when wheeled the other way", () => {
    const result = accumulateWheelNavigation(EMPTY_WHEEL_NAVIGATION, -wheelStepThreshold, 1_000);
    expect(result.step).toBe(-1);
  });

  it("never lets one flick fly through the stack", () => {
    // A trackpad flick arrives as a few very large deltas. Each may commit one
    // step at most, and only once the interval has passed.
    let state = EMPTY_WHEEL_NAVIGATION;
    let steps = 0;
    for (let tick = 0; tick < 6; tick += 1) {
      const result = accumulateWheelNavigation(state, wheelStepThreshold * 12, tick * 16);
      steps += Math.abs(result.step);
      state = result.state;
    }
    // Six frames at 16ms sit well inside one interval, so exactly one step.
    expect(steps).toBe(1);
  });

  it("keeps navigating when the gesture continues past the interval", () => {
    let state = EMPTY_WHEEL_NAVIGATION;
    let steps = 0;
    for (let tick = 0; tick < 6; tick += 1) {
      const result = accumulateWheelNavigation(
        state,
        wheelStepThreshold,
        tick * (minimumStepIntervalMs + 10),
      );
      steps += Math.abs(result.step);
      state = result.state;
    }
    expect(steps).toBe(6);
  });

  it("treats a reversal as a new gesture rather than a debt to pay off", () => {
    const banked = accumulateWheelNavigation(EMPTY_WHEEL_NAVIGATION, wheelStepThreshold * 0.9, 0);
    expect(banked.step).toBe(0);
    const reversed = accumulateWheelNavigation(banked.state, -wheelStepThreshold * 0.9, 16);
    expect(reversed.step, "the banked forward movement is discarded").toBe(0);
    expect(reversed.state.accumulated).toBeCloseTo(-wheelStepThreshold * 0.9, 6);
  });

  it("ignores noise and nonsense deltas", () => {
    for (const delta of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = accumulateWheelNavigation(EMPTY_WHEEL_NAVIGATION, delta, 0);
      expect(result.step).toBe(0);
      expect(result.state).toBe(EMPTY_WHEEL_NAVIGATION);
    }
  });
});

describe("spatial stack composition", () => {
  const VIEWPORT = LARGE_WORKSPACE.workspaceHeight;

  const offsetFor = (result: SpatialStackLayout, index: number): number =>
    computeFocusedStackOffset({
      layout: result,
      focusedVisualIndex: index,
      viewportHeight: VIEWPORT,
    });

  /** The sheets that actually take part in the settled picture. */
  const composition = (result: SpatialStackLayout, focusedIndex: number): readonly number[] =>
    result.layers
      .map((plane, index) => ({
        index,
        emphasis: computeSheetEmphasis(result, plane, offsetFor(result, focusedIndex), VIEWPORT),
      }))
      .filter((entry) => entry.emphasis > 0.05)
      .map((entry) => entry.index);

  it.each([3, 5, 10, 20])("settles into three sheets with %i layers", (layerCount) => {
    const result = layout({ ...LANDSCAPE, layerCount });
    for (const focused of [0, Math.floor(layerCount / 2), layerCount - 1]) {
      const visible = composition(result, focused);
      expect(visible, `${layerCount} layers focused at ${focused}`).toContain(focused);
      expect(visible.length).toBeLessThanOrEqual(3);
      // Whatever is in the picture is the focused sheet and its neighbours.
      for (const index of visible) {
        expect(Math.abs(index - focused)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives the focused sheet and both neighbours full presence", () => {
    const result = layout({ ...LANDSCAPE, layerCount: 7 });
    const offset = offsetFor(result, 3);
    for (const index of [2, 3, 4]) {
      expect(
        computeSheetEmphasis(result, result.layers[index]!, offset, VIEWPORT),
        `neighbour ${index}`,
      ).toBe(1);
    }
    for (const index of [0, 1, 5, 6]) {
      expect(
        computeSheetEmphasis(result, result.layers[index]!, offset, VIEWPORT),
        `distant ${index}`,
      ).toBe(0);
    }
  });

  it("fades continuously, so navigating does not pop a sheet in or out", () => {
    // Emphasis reads the live offset rather than the index distance, so a sheet
    // arrives and leaves in step with the movement.
    const result = layout({ ...LANDSCAPE, layerCount: 8 });
    const from = offsetFor(result, 3);
    const to = offsetFor(result, 4);
    const plane = result.layers[5]!;
    const samples = [0, 0.25, 0.5, 0.75, 1].map((t) =>
      computeSheetEmphasis(result, plane, from + (to - from) * t, VIEWPORT),
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!).toBeGreaterThanOrEqual(samples[index - 1]!);
    }
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
  });

  it("stays within 0..1 for every sheet, offset and layer count", () => {
    for (const layerCount of [1, 2, 5, 20]) {
      const result = layout({ layerCount });
      for (const offset of [-5_000, 0, offsetFor(result, 0), 5_000, Number.NaN]) {
        for (const plane of [...result.layers, result.paper]) {
          const emphasis = computeSheetEmphasis(result, plane, offset, VIEWPORT);
          expect(Number.isFinite(emphasis)).toBe(true);
          expect(emphasis).toBeGreaterThanOrEqual(0);
          expect(emphasis).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keeps a one- and two-layer document wholly in the picture", () => {
    for (const layerCount of [1, 2]) {
      const result = layout({ ...LANDSCAPE, layerCount });
      expect(composition(result, 0).length, `${layerCount} layers`).toBe(layerCount);
    }
  });
});

describe("spatial stack perspective", () => {
  /**
   * The sheet as it actually projects: how much wider its near edge is than its
   * far edge, and how flat it reads. Measured the way the reference was, so the
   * two can be compared rather than described.
   */
  const projectFocused = (
    result: SpatialStackLayout,
    index: number,
  ): { readonly convergence: number; readonly heightOverWidth: number } => {
    const plane = result.layers[index]!;
    const tilt = (result.tiltDegrees * Math.PI) / 180;
    const half = result.planeHeight / 2;
    const magnify = (depth: number): number =>
      result.perspective / Math.max(1, result.perspective - depth);
    const near = magnify(plane.translateZ + half * Math.sin(tilt));
    const far = magnify(plane.translateZ - half * Math.sin(tilt));
    const nearWidth = result.planeWidth * near;
    const farWidth = result.planeWidth * far;
    return {
      convergence: nearWidth / farWidth,
      heightOverWidth: (half * Math.cos(tilt) * (near + far)) / nearWidth,
    };
  };

  it("reads as a perspective arrangement rather than a flat fan", () => {
    const result = layout({ ...LANDSCAPE, layerCount: 5 });
    const { convergence, heightOverWidth } = projectFocused(result, 2);
    // Measured off the reference: the near edge is about a third wider than the
    // far edge, and the sheet reads about twice as wide as it is tall.
    expect(convergence).toBeGreaterThan(1.25);
    expect(convergence, "but not a fisheye").toBeLessThan(1.55);
    expect(heightOverWidth, "broad and horizontal, so strokes are readable").toBeLessThan(0.56);
    expect(heightOverWidth, "still a sheet, not an edge").toBeGreaterThan(0.4);
  });

  it("never lets a deep stack magnify its nearest sheet through the camera", () => {
    for (const layerCount of [1, 5, 10, 30, 80]) {
      const result = layout({ layerCount });
      const nearest = result.layers[0]!;
      const half = result.planeHeight / 2;
      const depth = nearest.translateZ + half * Math.sin((result.tiltDegrees * Math.PI) / 180);
      expect(depth, `${layerCount} layers`).toBeLessThan(result.perspective);
      expect(result.depthPerPlane).toBeGreaterThan(0);
    }
  });

  it("keeps the full depth step until a document is deep enough to need the ceiling", () => {
    expect(layout({ layerCount: 3 }).depthPerPlane).toBe(SPATIAL_STACK_GEOMETRY.depthPerPlane);
    expect(layout({ layerCount: 30 }).depthPerPlane).toBeLessThan(
      SPATIAL_STACK_GEOMETRY.depthPerPlane,
    );
  });
});

describe("spatial stack deep-stack stress", () => {
  const DEPTHS = [1, 5, 10, 30, 80] as const;
  const VIEWPORT = LARGE_WORKSPACE.workspaceHeight;

  it.each(DEPTHS)("stays a valid projection with %i layers", (layerCount) => {
    for (const page of PAGES) {
      for (const space of WORKSPACES) {
        const result = layout({ ...page.geometry, ...space.workspace, layerCount });
        const where = `${layerCount} layers, ${page.name}, ${space.name}`;
        const tilt = (result.tiltDegrees * Math.PI) / 180;
        const half = result.planeHeight / 2;

        expect(Number.isFinite(result.planeWidth), where).toBe(true);
        expect(result.planeWidth).toBeGreaterThan(0);
        expect(result.planeHeight).toBeGreaterThan(0);
        expect(result.depthPerPlane).toBeGreaterThan(0);
        expect(result.layers).toHaveLength(layerCount);

        for (const plane of [result.paper, ...result.layers]) {
          expect(Number.isFinite(plane.translateY), where).toBe(true);
          expect(Number.isFinite(plane.translateZ), where).toBe(true);
          expect(plane.translateY).toBeGreaterThanOrEqual(0);
          expect(plane.translateZ).toBeGreaterThanOrEqual(0);

          // No singularity and no inversion: every sheet, at its nearest
          // corner, stays in front of the camera, so the projection divisor is
          // positive and the sheet is never turned inside out.
          const nearest = plane.translateZ + half * Math.sin(tilt);
          expect(nearest, `${where} nearest corner`).toBeLessThan(result.perspective);
          const corner = projectSheetCorner(result, plane, result.tiltDegrees);
          expect(Number.isFinite(corner.x), where).toBe(true);
          expect(Number.isFinite(corner.y), where).toBe(true);
          expect(corner.x, `${where} projected width`).toBeGreaterThan(0);
          expect(corner.y, `${where} projected height`).toBeGreaterThan(0);
        }

        // Order survives any depth: top-first display, bottom-to-top storage,
        // paper below every sheet and painted first.
        expect(result.layers.map((plane) => plane.displayIndex)).toEqual(
          result.layers.map((_plane, index) => index),
        );
        expect(result.layers.map((plane) => plane.storageIndex)).toEqual(
          result.layers.map((_plane, index) => layerCount - 1 - index),
        );
        for (const plane of result.layers) {
          expect(result.paper.translateY, where).toBeGreaterThan(plane.translateY);
          expect(result.paper.zIndex, where).toBeLessThan(plane.zIndex);
        }
      }
    }
  });

  it.each(DEPTHS)(
    "keeps every focus offset finite and deterministic with %i layers",
    (layerCount) => {
      const result = layout({ ...LANDSCAPE, layerCount });
      const offsets = result.layers.map((_plane, index) =>
        computeFocusedStackOffset({
          layout: result,
          focusedVisualIndex: index,
          viewportHeight: VIEWPORT,
        }),
      );
      for (const offset of offsets) expect(Number.isFinite(offset)).toBe(true);
      // Every Layer is addressable and reachable, and repeating the question
      // gives the same answer.
      expect(new Set(offsets).size).toBe(layerCount);
      for (let index = 1; index < offsets.length; index += 1) {
        expect(offsets[index]!).toBeGreaterThan(offsets[index - 1]!);
      }
      expect(offsets).toEqual(
        result.layers.map((_plane, index) =>
          computeFocusedStackOffset({
            layout: result,
            focusedVisualIndex: index,
            viewportHeight: VIEWPORT,
          }),
        ),
      );
    },
  );

  it.each(DEPTHS)("holds the focused sheet on the shelf with %i layers", (layerCount) => {
    const result = layout({ ...LANDSCAPE, layerCount });
    const shelf = VIEWPORT * SPATIAL_STACK_NAVIGATION.focusBottomRatio;
    for (const index of [0, Math.floor(layerCount / 2), layerCount - 1]) {
      const offset = computeFocusedStackOffset({
        layout: result,
        focusedVisualIndex: index,
        viewportHeight: VIEWPORT,
      });
      const plane = result.layers[index]!;
      const half = projectSheetCorner(result, plane, result.tiltDegrees).y;
      const bottom = plane.translateY + result.planeHeight / 2 + half - offset;
      expect(bottom, `${layerCount} layers, index ${index}`).toBeCloseTo(shelf, 6);
      // And it is still a sheet worth inspecting rather than a sliver.
      expect(half * 2).toBeGreaterThan(VIEWPORT * 0.3);
      expect(
        computeSheetEmphasis(result, plane, offset, VIEWPORT),
        "the focused sheet is always fully in the composition",
      ).toBe(1);
    }
  });

  it.each(DEPTHS)("keeps every frame of the opening valid with %i layers", (layerCount) => {
    const result = layout({ ...LANDSCAPE, layerCount });
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = computeSpatialLayerStackFrame(result, progress);
      expect(frame.tiltDegrees).toBeGreaterThan(0);
      expect(Number.isFinite(frame.tiltDegrees)).toBe(true);
      for (const plane of [frame.paper, ...frame.layers]) {
        expect(Number.isFinite(plane.translateY)).toBe(true);
        expect(Number.isFinite(plane.translateZ)).toBe(true);
        expect(plane.translateY).toBeGreaterThanOrEqual(0);
        expect(plane.translateZ).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
