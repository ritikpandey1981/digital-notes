import { expect, test, type Page } from "@playwright/test";
import {
  addLayer,
  closeLayers,
  drawStroke,
  launchFolio,
  objectCount,
  openLayerList,
} from "./layers-stack-helpers";

/**
 * A notification stops taking pointer input the moment it stops being current.
 *
 * Dismissing one leaves it mounted while it plays its exit, which is what makes
 * the fade read as a departure. During that time it is no longer a live
 * notification: the user has dealt with it, and their next press belongs to
 * whatever is underneath. It used to keep its hit surface for the whole exit,
 * so a press into the bounds it was vacating was swallowed by something on its
 * way out and the canvas never saw it.
 */

interface ExitSample {
  readonly mounted: boolean;
  readonly presence: string | null;
  readonly pointerEvents: string | null;
  readonly hitsTheNotification: boolean;
  readonly hitTestId: string | null;
}

/** The centre of the notification, in viewport coordinates. */
async function notificationCentre(window: Page): Promise<Readonly<{ x: number; y: number }>> {
  const box = await window.getByTestId("notification").first().boundingBox();
  if (box === null) throw new Error("The notification must be measurable before it is dismissed.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Dismisses the notification and watches the vacated bounds frame by frame.
 *
 * Sampling happens inside the window, so nothing between the dismissal and the
 * first reading depends on how quickly the test runner is being served.
 */
async function sampleTheExit(window: Page): Promise<readonly ExitSample[]> {
  return window.evaluate(async () => {
    const card = document.querySelector<HTMLElement>('[data-testid="notification"]');
    if (card === null) throw new Error("Nothing to dismiss.");
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    card.querySelector<HTMLButtonElement>('[data-testid="notification-dismiss"]')?.click();

    const samples: unknown[] = [];
    await new Promise<void>((resolve) => {
      const tick = () => {
        const live = document.querySelector<HTMLElement>('[data-testid="notification"]');
        const hit = document.elementFromPoint(x, y);
        samples.push({
          mounted: live !== null,
          presence: live?.getAttribute("data-notification-presence") ?? null,
          pointerEvents: live === null ? null : getComputedStyle(live).pointerEvents,
          hitsTheNotification: live !== null && hit !== null && live.contains(hit),
          hitTestId: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
        });
        if (samples.length >= 30) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return samples as ExitSample[];
  });
}

/** Raises "Layer deleted", which is a notification that also offers an action. */
async function raiseLayerDeletedNotification(window: Page): Promise<void> {
  await addLayer(window);
  await openLayerList(window);
  const removable = window.locator('[data-testid^="layer-delete-"]:not([disabled])').first();
  await removable.click();
  await closeLayers(window);
  await expect(window.getByTestId("notification").first()).toBeVisible();
}

test("hands the pointer back to the canvas the moment a notification is dismissed", async () => {
  test.setTimeout(120_000);
  const { app, window } = await launchFolio();
  try {
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const surface = window.getByTestId("canvas-surface");

    // A + B + C, with a real pointer: a stroke started in the bounds a
    // notification is leaving is a stroke. Drawn once first, so a stroke that
    // fails to appear afterwards means the press was taken rather than that
    // this window was never going to draw.
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 420);
    await raiseLayerDeletedNotification(window);
    const centre = await notificationCentre(window);
    const before = Number(await objectCount(window));
    const card = window.getByTestId("notification").first();
    await window.getByTestId("notification-dismiss").first().click();
    // Armed after the dismissal, and pressed once the exit is genuinely under
    // way. The dismiss click carries a pointerdown of its own, and a press sent
    // in the same breath as it can arrive before React has even committed the
    // removal -- neither is the press being tested here.
    await expect(card).toHaveAttribute("data-notification-presence", "exiting");
    await window.evaluate(() => {
      const probe: { mounted: boolean; presence: string | null; target: string | null } = {
        mounted: false,
        presence: null,
        target: null,
      };
      (window as unknown as { __pointerProbe: typeof probe }).__pointerProbe = probe;
      document.addEventListener(
        "pointerdown",
        (event) => {
          const still = document.querySelector("[data-testid='notification']");
          probe.mounted = still !== null;
          probe.presence = still?.getAttribute("data-notification-presence") ?? null;
          probe.target =
            (event.target as Element | null)
              ?.closest("[data-testid]")
              ?.getAttribute("data-testid") ?? null;
        },
        { capture: true, once: true },
      );
    });
    await window.mouse.move(centre.x, centre.y);
    await window.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await window.mouse.move(centre.x + step * 8, centre.y - step * 6);
    }
    await window.mouse.up();
    const probe = await window.evaluate(
      () =>
        (
          window as unknown as {
            __pointerProbe: { mounted: boolean; presence: string | null; target: string | null };
          }
        ).__pointerProbe,
    );
    expect(probe.mounted, "the press landed after the exit had finished, proving nothing").toBe(
      true,
    );
    expect(probe.presence).toBe("exiting");
    expect(probe.target, "the press was taken by the departing notification").toBe(
      "canvas-surface",
    );
    await expect(surface).toHaveAttribute("data-document-object-count", String(before + 1));

    // The same thing again, watched frame by frame from inside the window, so
    // the whole exit is covered rather than the one instant a press landed in.
    await raiseLayerDeletedNotification(window);
    const samples = await sampleTheExit(window);
    const exiting = samples.filter((sample) => sample.mounted);
    expect(exiting.length, "the exit must still be in flight to prove anything").toBeGreaterThan(0);
    for (const sample of exiting) {
      expect(sample.presence, "a dismissed notification is no longer live").toBe("exiting");
      expect(sample.pointerEvents, "it must stop taking pointer input").toBe("none");
      expect(sample.hitsTheNotification, "a press in its bounds was swallowed").toBe(false);
      expect(sample.hitTestId, "the press must reach the canvas").toBe("canvas-surface");
    }

    // E. A notification that is still on offer is still interactive: it takes
    //    the press, and its action does what it says.
    await raiseLayerDeletedNotification(window);
    const live = window.getByTestId("notification").first();
    await expect(live).toHaveAttribute("data-notification-presence", "live");
    await expect(live).toHaveCSS("pointer-events", "auto");
    const depthAfterDelete = Number(await surface.getAttribute("data-history-undo-depth"));
    await window.getByTestId("notification-action").first().click();
    await expect(surface, "the offered Undo ran").toHaveAttribute(
      "data-history-undo-depth",
      String(depthAfterDelete - 1),
    );
    await expect(window.getByTestId("notification")).toHaveCount(0);

    // D. Reduced motion shortens the exit rather than removing it, so the same
    //    handover has to hold on that path.
    await window.emulateMedia({ reducedMotion: "reduce" });
    await raiseLayerDeletedNotification(window);
    const reduced = await sampleTheExit(window);
    for (const sample of reduced.filter((one) => one.mounted)) {
      expect(sample.presence, "reduced motion still plays an exit").toBe("exiting");
      expect(sample.pointerEvents).toBe("none");
      expect(sample.hitsTheNotification).toBe(false);
    }
    expect(reduced.at(-1)?.mounted, "a reduced-motion exit still finishes and unmounts").toBe(
      false,
    );
    await window.emulateMedia({ reducedMotion: "no-preference" });

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
