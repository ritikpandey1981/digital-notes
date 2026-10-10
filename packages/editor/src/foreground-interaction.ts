/**
 * Whether the user is in the middle of an interaction with the drawing surface.
 *
 * This is a responsiveness question and nothing else, and it is deliberately
 * not the question {@link ProjectSession.isPersistenceSettled} answers. That
 * one asks whether the document currently holds a state that is safe to
 * serialize, and during a stroke the answer is a genuine yes: a live mark is
 * not in the document at all, so the committed project stays exactly as safe
 * to write as it was before the pointer went down.
 *
 * What a stroke changes is not the safety of the bytes but the cost of
 * producing them. Several hundred milliseconds of synchronous encoding is
 * invisible between two marks and unmissable inside one.
 *
 * Merging the two would make the wrong thing true in both directions: either a
 * drawing document becomes unsafe to recover, which it is not, or an open
 * gesture becomes a fine moment for a long task, which it is not either.
 */
export interface ForegroundInteractionSource {
  /** True while an interaction is in progress that expensive work must not interrupt. */
  readonly isActive: () => boolean;
  /**
   * Observes the moment the last interaction in progress ends.
   *
   * A scheduler that defers work during input still has to notice that the
   * input is over, and polling for it would be a timer that exists only to ask
   * a question the input itself can answer.
   */
  readonly subscribeIdle: (listener: () => void) => () => void;
}

/**
 * The reporting half, held by whatever owns the input it describes.
 *
 * Presses are released one at a time, by id, and never by clearing the whole
 * signal: the signal belongs to the workspace, and a surface being torn down
 * must not announce that a hand holding a pen on another one is free. A surface
 * that will never see a release -- because the window lost focus, or because it
 * lost input ownership -- ends the presses it reported itself.
 */
export interface ForegroundInteractionReporter {
  /** Records a press. Reporting the same pointer twice changes nothing. */
  readonly begin: (pointerId: number) => void;
  /** Records a release. A pointer that was never begun is ignored. */
  readonly end: (pointerId: number) => void;
}

/**
 * Tracks presses on the editor surface for schedulers that must stay out of the
 * way of interaction.
 *
 * It counts pointers rather than gestures because a gesture is a tool's own
 * idea and a press is not: whichever tool is active, and whether its press
 * produces artwork, a selection, a pan or nothing at all, the person is doing
 * something and a long task would land in the middle of it.
 */
export class ForegroundInteractionTracker
  implements ForegroundInteractionSource, ForegroundInteractionReporter
{
  readonly #pointers = new Set<number>();
  readonly #idleListeners = new Set<() => void>();

  readonly isActive = (): boolean => this.#pointers.size > 0;

  readonly begin = (pointerId: number): void => {
    this.#pointers.add(pointerId);
  };

  readonly end = (pointerId: number): void => {
    if (!this.#pointers.delete(pointerId)) return;
    if (this.#pointers.size === 0) this.#publishIdle();
  };

  readonly subscribeIdle = (listener: () => void): (() => void) => {
    if (typeof listener !== "function") {
      throw new TypeError("A foreground interaction listener must be a function.");
    }
    this.#idleListeners.add(listener);
    return () => {
      this.#idleListeners.delete(listener);
    };
  };

  #publishIdle(): void {
    for (const listener of [...this.#idleListeners]) {
      try {
        listener();
      } catch {
        // A scheduler watching for the end of an interaction cannot be allowed
        // to interfere with the input that is reporting it.
      }
    }
  }
}
