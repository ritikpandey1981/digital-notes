import type { ResolvedBrushSnapshot } from "../../brush-model";
import { InkError } from "../../errors";
import { fineTipBoost, type MaterialDepositionContext } from "./deposition";
import { clumpCellSize } from "./fields";
import { pencilDabSpacing } from "./placement";
import { pencilMaterialResources } from "./resources";
import { MATERIAL_RESOLUTION } from "./tiles";

/**
 * Everything one stroke's material depends on that is not a dab.
 *
 * Resolved once, from the resolved snapshot alone. The point of gathering it
 * into one value is that **live accumulation and cold reconstruction take the
 * same one**: there is no path by which the two could end up reading different
 * resources, a different opacity or a different passage threshold, because
 * there is only one place either of them can get those from.
 */
export interface PencilMaterialProgram {
  readonly deposition: MaterialDepositionContext;
  /** Clump field cell size, in material cells. */
  readonly fieldCellSize: number;
  /** The paper the field cache for this program must be built from. */
  readonly paperResourceId: string;
}

/**
 * Resolves the material program for one snapshot.
 *
 * The snapshot's `renderer` is the only thing consulted for resource identity.
 * That is the whole durable resource contract: a stroke names `pencil@1`, and
 * `pencil@1` names its nib and its sheet. Nothing is stored in the artwork
 * beyond the strategy identity that was already there, and a build that does
 * not have those resources fails rather than substituting.
 */
export function createPencilMaterialProgram(brush: ResolvedBrushSnapshot): PencilMaterialProgram {
  if (brush.renderer.kind !== "pencil") {
    throw new InkError(
      "UNSUPPORTED_BRUSH_STRATEGY",
      `Pencil material cannot be evaluated for strategy '${brush.renderer.kind}'.`,
      { kind: brush.renderer.kind, version: brush.renderer.version },
    );
  }
  const resources = pencilMaterialResources(brush.renderer.version);
  return Object.freeze({
    deposition: Object.freeze({
      nib: resources.nib,
      opacity: brush.opacity,
      fineBoost: fineTipBoost(brush.size),
      spacing: pencilDabSpacing(brush),
    }),
    fieldCellSize: clumpCellSize(brush.size, MATERIAL_RESOLUTION),
    paperResourceId: resources.paper.id,
  });
}
