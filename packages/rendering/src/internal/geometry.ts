import { RenderingError } from "../errors";
import type { Insets, Point, Rect, RenderPage, RenderTheme, Size } from "../types";

export function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RenderingError("INVALID_GEOMETRY", `${name} must be finite.`, {
      name,
      value,
    });
  }
}

export function assertPoint(point: Point, name = "point"): void {
  assertFiniteNumber(point.x, `${name}.x`);
  assertFiniteNumber(point.y, `${name}.y`);
}

export function assertSize(size: Size, name = "size", allowZero = true): void {
  assertFiniteNumber(size.width, `${name}.width`);
  assertFiniteNumber(size.height, `${name}.height`);
  const minimum = allowZero ? 0 : Number.EPSILON;
  if (size.width < minimum || size.height < minimum) {
    throw new RenderingError(
      "INVALID_GEOMETRY",
      `${name} dimensions must be ${allowZero ? "non-negative" : "positive"}.`,
      { name, size },
    );
  }
}

export function assertRect(rect: Rect, name = "rect", allowZero = false): void {
  assertPoint(rect, name);
  assertSize(rect, name, allowZero);
}

export function normalizeInsets(value: number | Partial<Insets>, fallback: Insets): Insets {
  if (typeof value === "number") {
    assertFiniteNumber(value, "padding");
    if (value < 0) {
      throw new RenderingError("INVALID_GEOMETRY", "Padding must be non-negative.", { value });
    }
    return Object.freeze({ top: value, right: value, bottom: value, left: value });
  }

  const result = {
    top: value.top ?? fallback.top,
    right: value.right ?? fallback.right,
    bottom: value.bottom ?? fallback.bottom,
    left: value.left ?? fallback.left,
  };
  for (const [name, amount] of Object.entries(result)) {
    assertFiniteNumber(amount, `padding.${name}`);
    if (amount < 0) {
      throw new RenderingError("INVALID_GEOMETRY", "Padding must be non-negative.", {
        name,
        amount,
      });
    }
  }
  return Object.freeze(result);
}

export function freezePoint(point: Point): Point {
  return Object.freeze({ x: point.x, y: point.y });
}

export function freezeSize(size: Size): Size {
  return Object.freeze({ width: size.width, height: size.height });
}

export function freezeRect(rect: Rect): Rect {
  return Object.freeze({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

export function freezeRenderPage(page: RenderPage): RenderPage {
  const background = Object.freeze({ ...page.background });
  return Object.freeze({ rect: freezeRect(page.rect), background });
}

export function freezeRenderTheme(theme: RenderTheme): RenderTheme {
  return Object.freeze({ ...theme });
}
