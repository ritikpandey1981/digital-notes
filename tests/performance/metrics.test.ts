import { describe, expect, it } from "vitest";
import { summarize } from "./metrics";

describe("baseline statistics", () => {
  it("uses nearest-rank percentiles without claiming p99 from a small sample", () => {
    expect(summarize("small", [5, 1, 3, 2, 4])).toMatchObject({
      count: 5,
      min: 1,
      p50: 3,
      p95: 5,
      p99: null,
      max: 5,
    });
    expect(
      summarize(
        "large",
        Array.from({ length: 100 }, (_, index) => index + 1),
      ),
    ).toMatchObject({ p50: 50, p95: 95, p99: 99 });
  });
  it("rejects missing or invalid observations rather than reporting a zero baseline", () => {
    for (const values of [[], [NaN], [Infinity], [-1]])
      expect(() => summarize("invalid", values)).toThrow();
  });
});
