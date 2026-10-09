import type { ResolvedBrushSnapshot } from "../../brush-model";
import type { StrokePoint } from "../../types";
import { PencilDabIndex, createMutableDab, type MutableMaterialDab } from "./dab-index";
import { dabTileSupport, depositDab } from "./deposition";
import type { MaterialFieldCache } from "./fields";
import { PencilDabPlacement } from "./placement";
import type { PencilMaterialProgram } from "./program";
import {
  commitMaterialTile,
  createActiveMaterialTile,
  isBlankMaterialTile,
  type ActiveMaterialTile,
  type CommittedMaterialTile,
  type MaterialTileKey,
} from "./tiles";

/**
 * Rebuilding material without stopping the editor.
 *
 * A cold viewport of a large project is hundreds of milliseconds of exact
 * per-pixel work. Done in one task it is a visible freeze; done in slices it is
 * invisible, because the work was never urgent -- only the first tile is.
 *
 * Four rules, and each one exists because leaving it out breaks something a
 * user can see:
 *
 * - **Slices, not tasks.** Work runs for {@link SLICE_BUDGET_MS} and yields, so
 *   a frame that wants the main thread gets it.
 * - **Publish whole tiles only.** A half-deposited tile is not a lighter
 *   version of the finished one, it is a different picture. Scratch stays
 *   private until its last dab lands.
 * - **Rotate between strokes.** One heavy mark must not starve the twenty
 *   around it; a viewport where one stroke finishes and the rest are blank
 *   reads as broken in a way that a viewport filling in evenly does not.
 * - **Ownership, checked at publication.** A job whose generation, runtime or
 *   request has moved on publishes nothing. Cancellation is therefore a number
 *   change rather than an unwind, and no stale tile can reach a live cache.
 *
 * None of it is durable, and none of it can change a pixel -- only when one
 * appears. That is what makes it safe to be this aggressive.
 */

/** How long one slice may run before yielding the main thread. */
export const SLICE_BUDGET_MS = 4;

/**
 * Dabs deposited before the clock is consulted and the rotation advances.
 *
 * Small enough that a broad tile cannot overrun its slice by much -- a 26 px
 * dab covers a few thousand cells -- and large enough that the check is not
 * most of the work at 2 px.
 */
const QUANTUM_DABS = 48;

/** Samples placed per chunk when an index is built cooperatively. */
const INDEX_CHUNK_SAMPLES = 512;

/**
 * Where an index build stops being cheap enough to do inline.
 *
 * Below this the build is a fraction of one tile's reconstruction and splitting
 * it would cost more in bookkeeping than it saved. Above it a build is its own
 * multi-slice job, because an ordinary stroke never reaches this and the ones
 * that do are exactly the ones that would stall a frame.
 */
export const INLINE_INDEX_SAMPLE_LIMIT = 2000;

/**
 * Jobs allowed to hold scratch at once.
 *
 * Each started job owns one active tile: 112 KiB, so sixteen is 1.75 MiB of
 * bounded scratch. The prototype found 16 and 32 indistinguishable on
 * throughput, so this takes the smaller one -- an editor gains nothing from
 * thirty-two half-finished strokes that it does not gain from sixteen.
 */
export const MAXIMUM_CONCURRENT_JOBS = 16;

/**
 * What a piece of work is for, which is the only thing that decides its order.
 *
 * Lower runs first, and a class never yields to a higher number while it has
 * work left -- so visible material cannot be delayed by anything speculative.
 */
export const MaterialPriority = Object.freeze({
  /** The stroke under the pointer, or the tiles next to it. */
  Active: 0,
  /** Visible, and near the middle of what the artist is looking at. */
  VisibleCenter: 1,
  /** Visible, but at the edge of the viewport. */
  VisiblePeripheral: 2,
  /** Not visible. Nothing requests this today; the class exists so that it cannot be confused with visible work when something does. */
  Background: 3,
} as const);

export type MaterialPriorityValue = (typeof MaterialPriority)[keyof typeof MaterialPriority];

/** One stroke's worth of requested material. */
export interface MaterialTileRequest {
  readonly strokeId: string;
  readonly points: readonly StrokePoint[];
  readonly brush: ResolvedBrushSnapshot;
  readonly program: PencilMaterialProgram;
  readonly priority: MaterialPriorityValue;
  /** Tiles wanted, in the order they should appear. */
  readonly tileKeys: readonly MaterialTileKey[];
  /** The colour a presentation for these tiles must be tinted with. */
  readonly color: string;
}

/** What the scheduler needs from its owner, and everything it is allowed to touch. */
export interface MaterialSchedulerHost {
  /** False once the owning runtime has been retired. Checked before every publication. */
  isActive(): boolean;
  fieldsFor(program: PencilMaterialProgram): MaterialFieldCache;
  /** A resident index, or null when one must be built. */
  index(strokeId: string): PencilDabIndex | null;
  adoptIndex(strokeId: string, index: PencilDabIndex): void;
  /** Accepts one finished tile. Called only for complete, owned, current work. */
  publish(strokeId: string, tile: CommittedMaterialTile): void;
  /**
   * True when a tile is drawable right now, so the scheduler never repeats work
   * the cache already holds.
   */
  ready(strokeId: string, key: MaterialTileKey, color: string): boolean;
  /** True when a tile's material is deposited, whether or not it can be drawn. */
  resident(strokeId: string, key: MaterialTileKey): boolean;
  /**
   * Turns one finished tile into something drawable. Returns whether it did any
   * work, so a quantum is spent on a presentation and no more.
   */
  prepare(strokeId: string, key: MaterialTileKey, color: string): boolean;
  /** Called after a slice that published anything, so the compositor can repaint. */
  onPublished(strokeId: string, keys: readonly MaterialTileKey[]): void;
}

interface IndexBuild {
  readonly placement: PencilDabPlacement;
  readonly index: PencilDabIndex;
  consumed: StrokePoint[];
  position: number;
}

interface TileBuild {
  readonly key: MaterialTileKey;
  readonly ids: Uint32Array;
  readonly tile: ActiveMaterialTile;
  position: number;
}

interface MaterialJob {
  readonly request: MaterialTileRequest;
  readonly generation: number;
  pending: MaterialTileKey[];
  index: PencilDabIndex | null;
  indexBuild: IndexBuild | null;
  tile: TileBuild | null;
  /**
   * Tiles whose material is settled and whose drawable form is still to be
   * made, one quantum each.
   *
   * Deliberately drained only once the job has nothing left to deposit. A
   * presentation reads one cell of each neighbour so that a magnified tile has
   * a true edge, so presenting a tile while its neighbours are still arriving
   * builds a gutter that the next tile immediately invalidates -- correct, and
   * a great deal of work to reach the same picture. Depositing first means
   * every gutter is built once, from material that is already there.
   */
  present: MaterialTileKey[];
  published: MaterialTileKey[];
}

export interface MaterialSchedulerStats {
  readonly generation: number;
  readonly queuedJobs: number;
  readonly startedJobs: number;
  readonly slices: number;
  readonly sliceMillisecondsTotal: number;
  readonly longestSliceMilliseconds: number;
  readonly tilesPublished: number;
  readonly tilesCancelled: number;
  readonly jobsCancelled: number;
  readonly indexBuilds: number;
  readonly chunkedIndexBuilds: number;
}

/** A yield that is not a timer, so a slice resumes on the next macrotask rather than in 4 ms. */
type Yielder = (run: () => void) => void;

function defaultYielder(): Yielder {
  if (typeof MessageChannel === "function") {
    const channel = new MessageChannel();
    let pending: (() => void) | null = null;
    channel.port1.onmessage = () => {
      const run = pending;
      pending = null;
      run?.();
    };
    return (run) => {
      pending = run;
      channel.port2.postMessage(null);
    };
  }
  return (run) => {
    setTimeout(run, 0);
  };
}

export class PencilReconstructionScheduler {
  readonly #host: MaterialSchedulerHost;
  readonly #yield: Yielder;
  readonly #now: () => number;
  readonly #jobs: MaterialJob[] = [];
  readonly #dab: MutableMaterialDab = createMutableDab();
  #generation = 0;
  #rotation = 0;
  #scheduled = false;
  #destroyed = false;
  #slices = 0;
  #sliceTotal = 0;
  #longestSlice = 0;
  #published = 0;
  #cancelledTiles = 0;
  #cancelledJobs = 0;
  #indexBuilds = 0;
  #chunkedIndexBuilds = 0;

  constructor(
    host: MaterialSchedulerHost,
    yielder: Yielder = defaultYielder(),
    now = () => performance.now(),
  ) {
    this.#host = host;
    this.#yield = yielder;
    this.#now = now;
  }

  get generation(): number {
    return this.#generation;
  }

  get pending(): boolean {
    return this.#jobs.length > 0;
  }

  /**
   * Replaces what the scheduler is working towards.
   *
   * Every request is authoritative and supersedes the last, because the thing
   * being described is "what is on screen now" -- and two answers to that
   * cannot both be true. Work already in flight for tiles still wanted is kept;
   * everything else is dropped where it stands.
   */
  request(requests: readonly MaterialTileRequest[]): void {
    if (this.#destroyed) return;
    this.#generation += 1;
    const wanted = new Map<string, MaterialTileRequest>();
    for (const request of requests) wanted.set(request.strokeId, request);

    for (let index = this.#jobs.length - 1; index >= 0; index -= 1) {
      const job = this.#jobs[index];
      if (job === undefined) continue;
      const replacement = wanted.get(job.request.strokeId);
      if (replacement === undefined || replacement.brush !== job.request.brush) {
        this.#jobs.splice(index, 1);
        this.#cancelledJobs += 1;
        if (job.tile !== null) this.#cancelledTiles += 1;
        continue;
      }
      // The index and any half-built tile survive a churn that still wants
      // them, which is what makes a pan cheap rather than a restart.
      const keep = new Set(replacement.tileKeys);
      job.pending = replacement.tileKeys.filter(
        (key) => keep.has(key) && !this.#host.ready(replacement.strokeId, key, replacement.color),
      );
      if (job.tile !== null && !keep.has(job.tile.key)) {
        job.tile = null;
        this.#cancelledTiles += 1;
      }
      this.#jobs[index] = { ...job, request: replacement, generation: this.#generation };
      wanted.delete(replacement.strokeId);
    }

    for (const request of wanted.values()) {
      const pending = request.tileKeys.filter(
        (key) => !this.#host.ready(request.strokeId, key, request.color),
      );
      if (pending.length === 0) continue;
      this.#jobs.push({
        request,
        generation: this.#generation,
        pending,
        index: this.#host.index(request.strokeId),
        indexBuild: null,
        tile: null,
        present: [],
        published: [],
      });
    }
    this.#prune();
    this.#schedule();
  }

  /** Drops every job. Nothing in flight can publish afterwards. */
  cancelAll(): void {
    this.#generation += 1;
    this.#cancelledJobs += this.#jobs.length;
    for (const job of this.#jobs) if (job.tile !== null) this.#cancelledTiles += 1;
    this.#jobs.length = 0;
    this.#rotation = 0;
  }

  /** Drops one stroke's work, for a mark that no longer exists. */
  cancelStroke(strokeId: string): void {
    for (let index = this.#jobs.length - 1; index >= 0; index -= 1) {
      if (this.#jobs[index]?.request.strokeId !== strokeId) continue;
      if (this.#jobs[index]?.tile != null) this.#cancelledTiles += 1;
      this.#jobs.splice(index, 1);
      this.#cancelledJobs += 1;
    }
  }

  destroy(): void {
    this.cancelAll();
    this.#destroyed = true;
  }

  /** Runs slices until the queue drains. For tests, and for a forced flush. */
  flush(limit = 10_000): void {
    let slices = 0;
    while (this.#jobs.length > 0 && slices < limit) {
      this.#runSlice();
      slices += 1;
    }
  }

  stats(): MaterialSchedulerStats {
    return Object.freeze({
      generation: this.#generation,
      queuedJobs: this.#jobs.length,
      startedJobs: this.#jobs.filter((job) => job.tile !== null || job.indexBuild !== null).length,
      slices: this.#slices,
      sliceMillisecondsTotal: this.#sliceTotal,
      longestSliceMilliseconds: this.#longestSlice,
      tilesPublished: this.#published,
      tilesCancelled: this.#cancelledTiles,
      jobsCancelled: this.#cancelledJobs,
      indexBuilds: this.#indexBuilds,
      chunkedIndexBuilds: this.#chunkedIndexBuilds,
    });
  }

  #schedule(): void {
    if (this.#scheduled || this.#destroyed || this.#jobs.length === 0) return;
    this.#scheduled = true;
    this.#yield(() => {
      this.#scheduled = false;
      if (this.#destroyed) return;
      this.#runSlice();
      this.#schedule();
    });
  }

  /**
   * One slice: rotate through the highest-priority jobs, a quantum each, until
   * the budget is spent.
   */
  #runSlice(): void {
    const started = this.#now();
    if (!this.#host.isActive()) {
      this.cancelAll();
      return;
    }
    const published = new Map<string, MaterialTileKey[]>();
    let guard = 0;
    while (this.#jobs.length > 0 && this.#now() - started < SLICE_BUDGET_MS && guard < 4096) {
      guard += 1;
      const job = this.#nextJob();
      if (job === null) break;
      const finished = this.#advance(job);
      if (finished !== null) {
        const keys = published.get(job.request.strokeId) ?? [];
        keys.push(finished);
        published.set(job.request.strokeId, keys);
      }
      this.#prune();
    }
    const elapsed = this.#now() - started;
    this.#slices += 1;
    this.#sliceTotal += elapsed;
    this.#longestSlice = Math.max(this.#longestSlice, elapsed);
    for (const [strokeId, keys] of published) this.#host.onPublished(strokeId, keys);
  }

  /**
   * The next job to give a quantum to.
   *
   * Rotation is within one priority class: the highest class with work takes
   * the whole slice, and inside it every job is served in turn. The concurrency
   * cap applies to jobs holding scratch, so a job past the cap waits rather
   * than allocating.
   */
  #nextJob(): MaterialJob | null {
    let best: MaterialPriorityValue | null = null;
    for (const job of this.#jobs) {
      if (best === null || job.request.priority < best) best = job.request.priority;
    }
    if (best === null) return null;
    const eligible: MaterialJob[] = [];
    let holdingScratch = 0;
    for (const job of this.#jobs) {
      if (job.tile !== null || job.indexBuild !== null) holdingScratch += 1;
    }
    for (const job of this.#jobs) {
      if (job.request.priority !== best) continue;
      const started = job.tile !== null || job.indexBuild !== null;
      if (!started && holdingScratch >= MAXIMUM_CONCURRENT_JOBS) continue;
      eligible.push(job);
    }
    if (eligible.length === 0)
      return this.#jobs.find((job) => job.request.priority === best) ?? null;
    const job = eligible[this.#rotation % eligible.length] ?? null;
    this.#rotation = (this.#rotation + 1) % Math.max(1, eligible.length);
    return job;
  }

  /** One quantum of one job. Returns the tile key it completed, or null. */
  #advance(job: MaterialJob): MaterialTileKey | null {
    if (job.index === null && job.indexBuild === null) {
      const resident = this.#host.index(job.request.strokeId);
      if (resident !== null) job.index = resident;
      else if (job.request.points.length <= INLINE_INDEX_SAMPLE_LIMIT) {
        // Small enough that splitting it would cost more bookkeeping than work.
        const index = PencilDabIndex.build(job.request.points, job.request.brush);
        this.#indexBuilds += 1;
        job.index = index;
        this.#host.adoptIndex(job.request.strokeId, index);
      } else {
        this.#chunkedIndexBuilds += 1;
        job.indexBuild = {
          placement: new PencilDabPlacement(job.request.brush),
          index: new PencilDabIndex(),
          consumed: [],
          position: 0,
        };
      }
      return null;
    }

    if (job.indexBuild !== null) {
      const build = job.indexBuild;
      const points = job.request.points;
      const end = Math.min(build.position + INDEX_CHUNK_SAMPLES, points.length);
      for (let index = build.position; index < end; index += 1) {
        const point = points[index];
        if (point !== undefined) build.consumed.push(point);
      }
      build.position = end;
      const final = end >= points.length;
      build.index.append(build.placement.append(build.consumed, final).settled);
      if (!final) return null;
      job.indexBuild = null;
      job.index = build.index.seal();
      this.#indexBuilds += 1;
      this.#host.adoptIndex(job.request.strokeId, job.index);
      return null;
    }

    // A presentation is its own quantum, so a burst of them cannot run away
    // with a slice any more than a burst of deposition can. They wait until
    // there is nothing left to deposit, so that each gutter is built from
    // neighbours that have already arrived.
    if (job.pending.length === 0 && job.tile === null && job.present.length > 0) {
      const key = job.present.shift();
      if (key === undefined) return null;
      if (!this.#host.isActive() || job.generation !== this.#generation) return null;
      return this.#host.prepare(job.request.strokeId, key, job.request.color) ? key : null;
    }

    const index = job.index;
    if (index === null) return null;
    if (job.tile === null) {
      while (job.pending.length > 0) {
        const key = job.pending.shift();
        if (key === undefined) break;
        if (this.#host.ready(job.request.strokeId, key, job.request.color)) continue;
        const membership = index.membership(key);
        if (membership === null) continue;
        if (this.#host.resident(job.request.strokeId, key)) {
          // Deposited already; only the drawable form is missing, and that
          // waits until the rest of the neighbourhood has been deposited too.
          job.present.push(key);
          continue;
        }
        job.tile = {
          key,
          ids: membership.ids,
          tile: createActiveMaterialTile(membership.tx, membership.ty),
          position: 0,
        };
        break;
      }
      if (job.tile === null) return null;
    }

    const build = job.tile;
    const program = job.request.program;
    const fields = this.#host.fieldsFor(program);
    const end = Math.min(build.position + QUANTUM_DABS, build.ids.length);
    for (let cursor = build.position; cursor < end; cursor += 1) {
      const id = build.ids[cursor];
      if (id === undefined) continue;
      index.readDab(id, this.#dab);
      const support = dabTileSupport(this.#dab, build.tile.tx, build.tile.ty);
      if (support.x1 < support.x0 || support.y1 < support.y0) continue;
      const field = fields.region(
        build.tile.tx,
        build.tile.ty,
        program.fieldCellSize,
        support.x0,
        support.y0,
        support.x1,
        support.y1,
      );
      depositDab(build.tile, this.#dab, field, support, program.deposition);
    }
    build.position = end;
    if (end < build.ids.length) return null;

    job.tile = null;
    // Ownership is checked here rather than at the start, because a slice that
    // began legitimately can still finish into a runtime that has moved on.
    if (!this.#host.isActive() || job.generation !== this.#generation) {
      this.#cancelledTiles += 1;
      return null;
    }
    if (isBlankMaterialTile(build.tile.alpha)) return null;
    this.#host.publish(job.request.strokeId, commitMaterialTile(build.tile));
    this.#published += 1;
    job.published.push(build.key);
    // Deposited, not yet drawable. Its presentation is queued behind whatever
    // else this job still has to deposit.
    job.present.push(build.key);
    return build.key;
  }

  #prune(): void {
    for (let index = this.#jobs.length - 1; index >= 0; index -= 1) {
      const job = this.#jobs[index];
      if (job === undefined) continue;
      if (
        job.pending.length === 0 &&
        job.tile === null &&
        job.indexBuild === null &&
        job.present.length === 0
      ) {
        this.#jobs.splice(index, 1);
      }
    }
  }
}
