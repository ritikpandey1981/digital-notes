import { assertRect } from "./geometry";
import type { DirtyRegion } from "../types";

export class DirtyRegionAccumulator {
  private viewportDirty = false;
  private pageDirty = false;
  private readonly regions: DirtyRegion[] = [];

  get hasDirtyRegions(): boolean {
    return this.viewportDirty || this.pageDirty || this.regions.length > 0;
  }

  add(region: DirtyRegion): void {
    if (region.kind === "viewport") {
      this.viewportDirty = true;
      this.pageDirty = false;
      this.regions.length = 0;
      return;
    }
    if (this.viewportDirty) {
      return;
    }
    if (region.kind === "page") {
      this.pageDirty = true;
      this.regions.length = 0;
      return;
    }
    if (this.pageDirty) {
      return;
    }
    assertRect(region.rect, "dirtyRegion.rect");
    this.regions.push(
      Object.freeze({
        kind: "rect",
        rect: Object.freeze({ ...region.rect }),
        coordinateSpace: region.coordinateSpace,
      }),
    );
  }

  consume(): readonly DirtyRegion[] {
    let result: readonly DirtyRegion[];
    if (this.viewportDirty) {
      result = Object.freeze([{ kind: "viewport" as const }]);
    } else if (this.pageDirty) {
      result = Object.freeze([{ kind: "page" as const }]);
    } else {
      result = Object.freeze([...this.regions]);
    }
    this.clear();
    return result;
  }

  clear(): void {
    this.viewportDirty = false;
    this.pageDirty = false;
    this.regions.length = 0;
  }
}
