/**
 * How an open colour session is resolved when tool ownership moves.
 *
 * Choosing another drawing slot, utility tool, library brush or shape replaces
 * the creation colour target. That is a *deliberate end* to the colour edit,
 * not an abort: the artist picked a colour and then went back to drawing, so
 * the colour they chose must survive.
 *
 * Before this rule existed the only thing that noticed the change was the
 * workspace's valid-target guard, which saw a session pointing at a target that
 * no longer existed and cancelled it — and cancelling a history-free creation
 * target restores the colour the picker opened on. The edit was therefore
 * silently reverted by the act of switching tools, unless a stroke had already
 * committed the session first.
 *
 * The fix is to resolve the session at the boundary that actually moves
 * ownership, and to resolve it as a commit. Cancel keeps meaning exactly what
 * it meant: the target is genuinely gone, or the artist aborted.
 */
export type CreationColorSessionResolution = "commit" | "none";

/**
 * Decides whether an ownership change must commit the open colour session.
 *
 * `"commit"` only when the open session belongs to the creation target that is
 * about to be replaced. Everything else is `"none"`, which means this boundary
 * has no opinion and the existing rules stand — importantly, a selected-object
 * session (`selected-vector-<objectId>`) never matches a creation target, so
 * object colour editing keeps its own transaction semantics untouched.
 */
export function resolveCreationColorSession(
  openSessionTargetId: string | null,
  activeCreationTargetId: string | null,
): CreationColorSessionResolution {
  if (openSessionTargetId === null || activeCreationTargetId === null) return "none";
  return openSessionTargetId === activeCreationTargetId ? "commit" : "none";
}
