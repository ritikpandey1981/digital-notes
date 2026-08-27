import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissalStackScopes,
  isTopDismissalScope,
  pushDismissal,
  resetDismissalStack,
} from "./floating-dismissal-stack";

describe("floating dismissal stack ownership", () => {
  beforeEach(() => resetDismissalStack());

  it("exposes exactly the latest surface as the outside-pointer owner", () => {
    const releasePages = pushDismissal("pages", vi.fn());
    const releaseLayers = pushDismissal("layers", vi.fn());

    expect(dismissalStackScopes()).toEqual(["pages", "layers"]);
    expect(isTopDismissalScope("pages")).toBe(false);
    expect(isTopDismissalScope("layers")).toBe(true);

    releaseLayers();
    expect(isTopDismissalScope("pages")).toBe(true);
    releasePages();
    expect(isTopDismissalScope("pages")).toBe(false);
  });
});
