import { describe, expect, it, vi } from "vitest";
import { ForegroundInteractionTracker } from "../foreground-interaction";

/**
 * The signal that keeps expensive background work out of an interaction.
 *
 * It answers one question -- is a hand busy -- and it answers it about presses
 * rather than about the document, because a mark being drawn is not in the
 * document and the document is therefore no help in deciding.
 */
describe("foreground interaction tracking", () => {
  it("is idle until something is pressed", () => {
    const tracker = new ForegroundInteractionTracker();
    expect(tracker.isActive()).toBe(false);
    tracker.begin(1);
    expect(tracker.isActive()).toBe(true);
    tracker.end(1);
    expect(tracker.isActive()).toBe(false);
  });

  it("stays active until the last of several presses lifts", () => {
    const tracker = new ForegroundInteractionTracker();
    const idle = vi.fn();
    tracker.subscribeIdle(idle);

    tracker.begin(1);
    tracker.begin(2);
    tracker.end(1);
    // One finger up is not the end of the interaction.
    expect(tracker.isActive()).toBe(true);
    expect(idle).not.toHaveBeenCalled();

    tracker.end(2);
    expect(tracker.isActive()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("treats a repeated press as the same press", () => {
    const tracker = new ForegroundInteractionTracker();
    const idle = vi.fn();
    tracker.subscribeIdle(idle);

    tracker.begin(1);
    tracker.begin(1);
    tracker.end(1);

    // Counting the same pointer twice would leave the signal stuck on, and a
    // stuck signal means the work being deferred never happens again.
    expect(tracker.isActive()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("ignores the release of a press it never saw", () => {
    const tracker = new ForegroundInteractionTracker();
    const idle = vi.fn();
    tracker.subscribeIdle(idle);

    // Releases are observed in front of the whole application, so most of them
    // belong to something else entirely.
    tracker.end(9);
    expect(idle).not.toHaveBeenCalled();

    tracker.begin(1);
    tracker.end(9);
    expect(tracker.isActive()).toBe(true);
    expect(idle).not.toHaveBeenCalled();
  });

  it("announces one idle transition, not one release", () => {
    const tracker = new ForegroundInteractionTracker();
    const idle = vi.fn();
    tracker.subscribeIdle(idle);

    tracker.begin(1);
    tracker.end(1);
    tracker.end(1);
    expect(idle).toHaveBeenCalledTimes(1);

    tracker.begin(2);
    tracker.end(2);
    expect(idle).toHaveBeenCalledTimes(2);
  });

  it("stops telling a listener that unsubscribed", () => {
    const tracker = new ForegroundInteractionTracker();
    const idle = vi.fn();
    const release = tracker.subscribeIdle(idle);

    tracker.begin(1);
    tracker.end(1);
    expect(idle).toHaveBeenCalledTimes(1);

    release();
    release();
    tracker.begin(1);
    tracker.end(1);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("lets no listener interfere with the input reporting it", () => {
    const tracker = new ForegroundInteractionTracker();
    const after = vi.fn();
    tracker.subscribeIdle(() => {
      throw new Error("a scheduler fell over");
    });
    tracker.subscribeIdle(after);

    tracker.begin(1);
    expect(() => tracker.end(1)).not.toThrow();
    // The press is reported by a pointer handler. A listener that throws must
    // not become a failure in the gesture that told it the truth.
    expect(after).toHaveBeenCalledTimes(1);
    expect(tracker.isActive()).toBe(false);
  });

  it("refuses a listener that is not callable", () => {
    const tracker = new ForegroundInteractionTracker();
    expect(() => tracker.subscribeIdle(undefined as unknown as () => void)).toThrow(TypeError);
  });
});
